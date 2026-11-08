#!/usr/bin/env python3
"""
MRV3D — 3D Printer Agent (agente local de monitoramento)

Roda na rede da loja (Windows, Linux ou Raspberry Pi), lê o estado das impressoras e envia ao
painel por HTTPS de saída. Não abre portas, não envia comandos às impressoras (somente leitura)
e guarda as credenciais das impressoras (código LAN, chave de API) só neste computador.

Uso rápido:
  python3 mrv3d_agente.py parear CODIGO --site https://mrv3dsolutions.tech
  python3 mrv3d_agente.py adicionar bambu --nome "P1S 1" --ip 192.168.0.50 --serial 01P00A123456789 --codigo 12345678
  python3 mrv3d_agente.py adicionar moonraker --nome "Voron" --ip 192.168.0.60
  python3 mrv3d_agente.py adicionar octoprint --nome "Ender" --ip 192.168.0.70 --api-key XXXXX
  python3 mrv3d_agente.py testar
  python3 mrv3d_agente.py descobrir        (procura impressoras Bambu Lab na rede, só escuta)
  python3 mrv3d_agente.py rodar            (deixe rodando; use o serviço do sistema para iniciar sozinho)

Bambu Lab: requer a biblioteca paho-mqtt (pip install paho-mqtt). A leitura por MQTT na rede local
depende do modelo e do firmware; nos firmwares com controle de autorização, use o modo LAN Only
(com ou sem Modo Desenvolvedor) conforme a documentação oficial da Bambu Lab.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import logging.handlers
import os
import platform
import re
import socket
import ssl
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

VERSAO = "0.1.0"
PASTA = Path(os.environ.get("MRV3D_AGENTE_DIR", Path.home() / ".mrv3d-agente"))
CONFIG = PASTA / "config.json"
FILA = PASTA / "fila_eventos.json"
FILA_MAX = 1000
INTERVALO = 15  # segundos entre envios
log = logging.getLogger("mrv3d")

ESTADOS = {"disponivel", "preparando", "imprimindo", "pausada", "finalizando", "concluida", "cancelada", "falha", "erro", "desconhecido"}


def agora() -> str:
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- configuração
def ler_config() -> dict:
    if not CONFIG.exists():
        return {"impressoras": []}
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def salvar_config(cfg: dict) -> None:
    PASTA.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)  # só o dono lê (token e códigos de acesso)
    except OSError:
        pass
    tmp.replace(CONFIG)


def host_permitido(host: str, permitir_publico: bool = False) -> bool:
    """Proteção contra SSRF: por padrão só endereços da rede local."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified:
            return False
        if not (ip.is_private or permitir_publico):
            return False
    return True


def slug(texto: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", texto.strip()).strip("-")
    return (s or "impressora")[:64].rjust(3, "x")


# --------------------------------------------------------------------------- adaptadores
class PrinterAdapter(ABC):
    """Interface comum. Só leitura: controle (pausar/retomar/cancelar/imprimir) NÃO é implementado."""

    tipo = ""

    def __init__(self, conf: dict):
        self.conf = conf
        self.nome = conf.get("nome") or conf.get("host")

    @property
    def dispositivo_id(self) -> str:
        return self.conf["dispositivo_id"]

    def connect(self) -> None: ...
    def disconnect(self) -> None: ...

    def get_capabilities(self) -> dict:
        return {"monitoramento": True, "controle": False, "camera": False}

    @abstractmethod
    def get_status(self) -> dict:
        """Estado normalizado (ver normalizar_*)."""

    def get_device_info(self) -> dict:
        return {"tipo_conexao": self.tipo, "dispositivo_id": self.dispositivo_id, "nome": self.nome}


def _http_json(url: str, headers: dict | None = None, timeout: float = 6) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": f"mrv3d-agente/{VERSAO}", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (host validado antes)
        return json.loads(r.read(2_000_000).decode("utf-8"))


def _num(v, lo=None, hi=None):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n != n or (lo is not None and n < lo) or (hi is not None and n > hi):
        return None
    return round(n, 2)


# ---- Moonraker (Klipper) — API documentada: https://moonraker.readthedocs.io
def normalizar_moonraker(res: dict) -> dict:
    st = res.get("status", res)
    ps, sd, ex, bed = st.get("print_stats", {}), st.get("virtual_sdcard", {}), st.get("extruder", {}), st.get("heater_bed", {})
    estado = {"standby": "disponivel", "printing": "imprimindo", "paused": "pausada", "complete": "concluida",
              "cancelled": "cancelada", "error": "erro"}.get(ps.get("state"), "desconhecido")
    prog = _num(st.get("display_status", {}).get("progress") or sd.get("progress"), 0, 1)
    dec = _num(ps.get("print_duration"), 0)
    restante = round(dec * (1 - prog) / prog) if dec and prog and 0 < prog < 1 else None
    return {"conexao": "online", "estado": estado, "arquivo": ps.get("filename") or None,
            "progresso": round(prog * 100, 1) if prog is not None else None, "decorrido_s": int(dec) if dec else None, "restante_s": restante,
            "temp_bico": _num(ex.get("temperature"), -40, 600), "temp_bico_alvo": _num(ex.get("target"), 0, 600),
            "temp_mesa": _num(bed.get("temperature"), -40, 300), "temp_mesa_alvo": _num(bed.get("target"), 0, 300),
            "erro_codigo": (ps.get("message") or None) if estado == "erro" else None}


class MoonrakerAdapter(PrinterAdapter):
    tipo = "moonraker"

    def get_status(self) -> dict:
        porta = self.conf.get("porta", 7125)
        url = f"http://{self.conf['host']}:{porta}/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed&display_status"
        headers = {"X-Api-Key": self.conf["api_key"]} if self.conf.get("api_key") else {}
        try:
            return normalizar_moonraker(_http_json(url, headers).get("result", {}))
        except urllib.error.HTTPError as e:
            return {"conexao": "erro_autenticacao" if e.code in (401, 403) else "offline", "estado": "desconhecido"}
        except (urllib.error.URLError, OSError, ValueError):
            return {"conexao": "offline", "estado": "desconhecido"}


# ---- OctoPrint — API documentada: https://docs.octoprint.org/en/master/api/
def normalizar_octoprint(printer: dict, job: dict) -> dict:
    flags = printer.get("state", {}).get("flags", {})
    if flags.get("error") or flags.get("closedOrError"):
        estado = "erro"
    elif flags.get("pausing") or flags.get("paused"):
        estado = "pausada"
    elif flags.get("cancelling"):
        estado = "cancelada"
    elif flags.get("finishing"):
        estado = "finalizando"
    elif flags.get("printing"):
        estado = "imprimindo"
    elif flags.get("operational") or flags.get("ready"):
        estado = "disponivel"
    else:
        estado = "desconhecido"
    t = printer.get("temperature", {})
    prog = job.get("progress", {}) or {}
    arq = ((job.get("job") or {}).get("file") or {}).get("name")
    return {"conexao": "online", "estado": estado, "arquivo": arq, "progresso": _num(prog.get("completion"), 0, 100),
            "decorrido_s": int(prog["printTime"]) if prog.get("printTime") else None, "restante_s": int(prog["printTimeLeft"]) if prog.get("printTimeLeft") else None,
            "temp_bico": _num(t.get("tool0", {}).get("actual"), -40, 600), "temp_bico_alvo": _num(t.get("tool0", {}).get("target"), 0, 600),
            "temp_mesa": _num(t.get("bed", {}).get("actual"), -40, 300), "temp_mesa_alvo": _num(t.get("bed", {}).get("target"), 0, 300),
            "temp_camara": _num(t.get("chamber", {}).get("actual"), -40, 150)}


class OctoPrintAdapter(PrinterAdapter):
    tipo = "octoprint"

    def get_status(self) -> dict:
        base = f"http://{self.conf['host']}:{self.conf.get('porta', 80)}"
        h = {"X-Api-Key": self.conf.get("api_key", "")}
        try:
            job = _http_json(base + "/api/job", h)
            try:
                printer = _http_json(base + "/api/printer", h)
            except urllib.error.HTTPError as e:
                if e.code == 409:  # impressora desconectada do OctoPrint
                    return {"conexao": "offline", "estado": "desconhecido"}
                raise
            return normalizar_octoprint(printer, job)
        except urllib.error.HTTPError as e:
            return {"conexao": "erro_autenticacao" if e.code in (401, 403) else "offline", "estado": "desconhecido"}
        except (urllib.error.URLError, OSError, ValueError):
            return {"conexao": "offline", "estado": "desconhecido"}


# ---- Bambu Lab (MQTT local, somente leitura)
BAMBU_ESTADOS = {"IDLE": "disponivel", "PREPARE": "preparando", "SLICING": "preparando", "RUNNING": "imprimindo", "PAUSE": "pausada",
                 "FINISH": "concluida", "FAILED": "falha"}


def normalizar_bambu(p: dict) -> dict:
    estado = BAMBU_ESTADOS.get(str(p.get("gcode_state", "")).upper(), "desconhecido")
    rest = _num(p.get("mc_remaining_time"), 0, 43200)
    ams = []
    for unidade in (p.get("ams") or {}).get("ams", [])[:4]:
        for bandeja in unidade.get("tray", [])[:4]:
            if bandeja.get("tray_type"):
                ams.append({"tipo": str(bandeja.get("tray_type"))[:20], "cor": str(bandeja.get("tray_color", ""))[:8]})
    erro = p.get("print_error")
    return {"conexao": "online", "estado": estado, "arquivo": p.get("subtask_name") or p.get("gcode_file") or None,
            "trabalho_id": str(p.get("job_id") or p.get("task_id") or "") or None,
            "progresso": _num(p.get("mc_percent"), 0, 100), "restante_s": int(rest * 60) if rest is not None else None,
            "camada": p.get("layer_num"), "total_camadas": p.get("total_layer_num"),
            "temp_bico": _num(p.get("nozzle_temper"), -40, 600), "temp_bico_alvo": _num(p.get("nozzle_target_temper"), 0, 600),
            "temp_mesa": _num(p.get("bed_temper"), -40, 300), "temp_mesa_alvo": _num(p.get("bed_target_temper"), 0, 300),
            "temp_camara": _num(p.get("chamber_temper"), -40, 150), "erro_codigo": f"{erro:08X}" if isinstance(erro, int) and erro else None,
            "ams": ams[:16]}


class BambuLanAdapter(PrinterAdapter):
    tipo = "bambu_lan"

    def __init__(self, conf: dict):
        super().__init__(conf)
        self._estado: dict = {}
        self._conexao = "offline"
        self._cli = None
        self._lock = threading.Lock()

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt  # type: ignore
        except ImportError:
            log.error("Bambu Lab precisa da biblioteca paho-mqtt: pip install paho-mqtt")
            self._conexao = "offline"
            return
        serial = self.conf["dispositivo_id"]
        try:
            cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"mrv3d-{uuid.uuid4().hex[:8]}")  # paho 2.x
        except AttributeError:
            cli = mqtt.Client(client_id=f"mrv3d-{uuid.uuid4().hex[:8]}")  # paho 1.x
        cli.username_pw_set("bblp", self.conf["codigo_acesso"])
        # a impressora usa certificado próprio na rede local; a conexão é cifrada e restrita a IP privado
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        cli.tls_set_context(ctx)

        def on_connect(c, _u, _f, rc, *_):
            codigo = getattr(rc, "value", rc)
            if codigo == 0:
                self._conexao = "online"
                c.subscribe(f"device/{serial}/report")
                # pede o estado completo uma vez (leitura; nenhum comando de impressão é enviado)
                c.publish(f"device/{serial}/request", json.dumps({"pushing": {"sequence_id": "0", "command": "pushall"}}))
            else:
                self._conexao = "erro_autenticacao" if codigo in (4, 5, 134, 135) else "offline"

        def on_disconnect(*_a):
            if self._conexao == "online":
                self._conexao = "offline"

        def on_message(_c, _u, msg):
            try:
                dados = json.loads(msg.payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return
            if isinstance(dados.get("print"), dict):
                with self._lock:
                    self._estado.update(dados["print"])  # a impressora manda atualizações parciais

        cli.on_connect, cli.on_disconnect, cli.on_message = on_connect, on_disconnect, on_message
        cli.reconnect_delay_set(min_delay=2, max_delay=60)
        try:
            cli.connect_async(self.conf["host"], int(self.conf.get("porta", 8883)), keepalive=60)
            cli.loop_start()
            self._cli = cli
        except OSError as e:
            log.warning("Bambu %s: %s", self.nome, e)

    def disconnect(self) -> None:
        if self._cli:
            self._cli.loop_stop()
            self._cli.disconnect()

    def get_status(self) -> dict:
        if self._conexao != "online":
            return {"conexao": self._conexao, "estado": "desconhecido"}
        with self._lock:
            if not self._estado:
                return {"conexao": "online", "estado": "desconhecido"}
            return normalizar_bambu(dict(self._estado))


ADAPTADORES = {"bambu_lan": BambuLanAdapter, "moonraker": MoonrakerAdapter, "octoprint": OctoPrintAdapter}


# --------------------------------------------------------------------------- eventos
class Detector:
    """Transforma leituras sucessivas em eventos (conectada, iniciada, concluída, falha…)."""

    def __init__(self):
        self.ant: dict[str, dict] = {}
        self.trabalho: dict[str, dict] = {}

    def _ev(self, ad_tipo, disp, tipo, trab=None, dados=None):
        return {"id": str(uuid.uuid4()), "tipo_conexao": ad_tipo, "dispositivo_id": disp, "tipo": tipo, "em": agora(),
                "trabalho": trab or {}, "dados": {k: v for k, v in (dados or {}).items() if v is not None}}

    def processar(self, ad_tipo: str, disp: str, s: dict) -> list[dict]:
        chave = f"{ad_tipo}:{disp}"
        a = self.ant.get(chave, {"conexao": None, "estado": None})
        ev = []
        if s.get("conexao") != a.get("conexao"):
            if s.get("conexao") == "online":
                ev.append(self._ev(ad_tipo, disp, "conectada"))
            elif s.get("conexao") == "erro_autenticacao":
                ev.append(self._ev(ad_tipo, disp, "erro_autenticacao"))
            elif a.get("conexao") == "online":
                ev.append(self._ev(ad_tipo, disp, "desconectada"))
        est, ea = s.get("estado"), a.get("estado")
        imprimindo = {"imprimindo", "pausada", "preparando"}
        trab = self.trabalho.get(chave)
        dados = {"progresso": s.get("progresso"), "decorrido_s": s.get("decorrido_s")}
        if s.get("conexao") == "online" and est in ("imprimindo", "preparando") and (ea not in imprimindo or (trab and s.get("trabalho_id") and s.get("trabalho_id") != trab["id"])):
            trab = {"id": s.get("trabalho_id") or f"{s.get('arquivo') or 'trabalho'}@{int(time.time())}", "arquivo": s.get("arquivo")}
            self.trabalho[chave] = trab
            ev.append(self._ev(ad_tipo, disp, "impressao_iniciada", trab, dados))
        elif trab and est == "pausada" and ea == "imprimindo":
            ev.append(self._ev(ad_tipo, disp, "impressao_pausada", trab, dados))
        elif trab and est == "imprimindo" and ea == "pausada":
            ev.append(self._ev(ad_tipo, disp, "impressao_retomada", trab, dados))
        elif trab and est in ("concluida", "falha", "cancelada", "erro") or (trab and est == "disponivel" and ea in imprimindo):
            tipo = {"concluida": "impressao_concluida", "falha": "impressao_falhou", "erro": "impressao_falhou", "cancelada": "impressao_cancelada"}.get(est)
            if tipo is None:  # voltou a "disponível" sem dizer como terminou
                tipo = "impressao_concluida" if (a.get("progresso") or 0) >= 99 else "impressao_cancelada"
            ev.append(self._ev(ad_tipo, disp, tipo, trab, {**dados, "codigo": s.get("erro_codigo")}))
            self.trabalho.pop(chave, None)
        tb, alvo = s.get("temp_bico"), s.get("temp_bico_alvo")
        # acima do alvo (com folga) ou acima do limite absoluto; sem alvo conhecido, só o limite absoluto
        anormal = tb is not None and ((alvo is not None and alvo > 0 and tb > alvo + 25) or tb > 320)
        if anormal and not a.get("temp_alerta"):
            ev.append(self._ev(ad_tipo, disp, "temperatura_anormal", trab, {"temp_bico": tb}))
            s = {**s, "temp_alerta": True}
        elif anormal:
            s = {**s, "temp_alerta": True}  # não repete o alerta enquanto continuar anormal
        if s.get("trabalho_id") is None and self.trabalho.get(chave):
            s = {**s, "trabalho_id": self.trabalho[chave]["id"]}
        self.ant[chave] = s
        return ev


class Fila:
    """Fila local limitada: guarda eventos enquanto a internet está fora."""

    def __init__(self, caminho: Path = FILA, maximo: int = FILA_MAX):
        self.caminho, self.maximo = caminho, maximo
        self.itens: list[dict] = json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else []

    def adicionar(self, eventos: list[dict]) -> None:
        self.itens.extend(eventos)
        if len(self.itens) > self.maximo:  # descarta os mais antigos
            self.itens = self.itens[-self.maximo:]
        self._salvar()

    def lote(self, n: int = 200) -> list[dict]:
        return self.itens[:n]

    def confirmar(self, ids: set[str]) -> None:
        self.itens = [e for e in self.itens if e["id"] not in ids]
        self._salvar()

    def _salvar(self) -> None:
        PASTA.mkdir(parents=True, exist_ok=True)
        self.caminho.write_text(json.dumps(self.itens), encoding="utf-8")


# --------------------------------------------------------------------------- servidor
def rpc(cfg: dict, nome: str, args: dict) -> dict:
    url = cfg["servidor"].rstrip("/") + "/rest/v1/rpc/" + nome
    if not url.startswith("https://") and not cfg.get("permitir_http"):
        raise SystemExit("O endereço do servidor precisa ser HTTPS")
    req = urllib.request.Request(url, data=json.dumps(args).encode(), method="POST",
                                 headers={"apikey": cfg["chave_publica"], "Authorization": f"Bearer {cfg['chave_publica']}",
                                          "Content-Type": "application/json", "User-Agent": f"mrv3d-agente/{VERSAO}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310
            return json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        corpo = e.read().decode(errors="replace")
        try:
            msg = json.loads(corpo).get("message", corpo)
        except ValueError:
            msg = corpo
        raise RuntimeError(msg[:300]) from None


def config_do_site(site: str) -> tuple[str, str]:
    """Lê o endereço do banco e a chave pública do /config.js do painel."""
    site = site.rstrip("/")
    if not site.startswith("https://"):
        raise SystemExit("Use o endereço https:// do painel")
    with urllib.request.urlopen(site + "/config.js", timeout=15) as r:  # noqa: S310
        txt = r.read(20000).decode()
    url = re.search(r'url\s*:\s*"([^"]+)"', txt)
    key = re.search(r'key\s*:\s*"([^"]+)"', txt)
    if not url or not key:
        raise SystemExit("Não encontrei a configuração do painel em " + site)
    return url.group(1), key.group(1)


# --------------------------------------------------------------------------- comandos
def cmd_parear(a):
    cfg = ler_config()
    cfg["servidor"], cfg["chave_publica"] = config_do_site(a.site)
    r = rpc(cfg, "agente_parear", {"p_codigo": a.codigo, "p_dados": {"versao": VERSAO, "maquina": socket.gethostname()[:100], "sistema": f"{platform.system()} {platform.release()}"[:60]}})
    cfg["token"] = r["token"]
    cfg["agente_id"] = r["agente_id"]
    salvar_config(cfg)
    print(f"Agente pareado com {r.get('empresa')}. Agora adicione as impressoras e rode: python3 {Path(__file__).name} rodar")


def cmd_adicionar(a):
    cfg = ler_config()
    if not host_permitido(a.ip, cfg.get("permitir_ip_publico", False)):
        raise SystemExit("Endereço recusado: use o IP da impressora na rede local (ex.: 192.168.x.x)")
    imp = {"tipo": a.tipo, "nome": a.nome, "host": a.ip}
    if a.porta:
        imp["porta"] = a.porta
    if a.tipo == "bambu_lan":
        if not a.serial or not a.codigo:
            raise SystemExit("Bambu Lab: informe --serial e --codigo (código de acesso LAN mostrado na tela da impressora)")
        imp["dispositivo_id"], imp["codigo_acesso"] = a.serial.upper(), a.codigo
    else:
        imp["dispositivo_id"] = slug(a.id or a.nome)
        if a.api_key:
            imp["api_key"] = a.api_key
        elif a.tipo == "octoprint":
            raise SystemExit("OctoPrint: informe --api-key (Configurações > Application Keys)")
    cfg["impressoras"] = [i for i in cfg.get("impressoras", []) if not (i["tipo"] == imp["tipo"] and i["dispositivo_id"] == imp["dispositivo_id"])] + [imp]
    salvar_config(cfg)
    print(f"Impressora adicionada. No painel, em Impressoras > Monitoramento, ligue a impressora a: tipo {a.tipo}, identificador {imp['dispositivo_id']}")


def criar_adaptadores(cfg) -> list[PrinterAdapter]:
    ads = []
    for imp in cfg.get("impressoras", []):
        if imp.get("tipo") not in ADAPTADORES:
            continue
        if not host_permitido(imp["host"], cfg.get("permitir_ip_publico", False)):
            log.error("Ignorando %s: endereço fora da rede local", imp.get("nome"))
            continue
        ads.append(ADAPTADORES[imp["tipo"]](imp))
    return ads


def cmd_testar(_a):
    cfg = ler_config()
    ads = criar_adaptadores(cfg)
    if not ads:
        raise SystemExit("Nenhuma impressora configurada")
    for ad in ads:
        ad.connect()
    time.sleep(6)
    for ad in ads:
        s = ad.get_status()
        print(f"- {ad.nome} ({ad.tipo}, {ad.dispositivo_id}): conexão {s.get('conexao')}, estado {s.get('estado')}, bico {s.get('temp_bico')} °C, mesa {s.get('temp_mesa')} °C")
        ad.disconnect()


def cmd_descobrir(a):
    """Escuta os anúncios SSDP das impressoras Bambu Lab (porta UDP 2021). Não envia nada à rede."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", 2021))
    except OSError as e:
        raise SystemExit(f"Não consegui escutar a porta 2021: {e}") from None
    s.settimeout(1)
    achadas, fim = {}, time.time() + a.segundos
    print(f"Procurando impressoras Bambu Lab por {a.segundos} s…")
    while time.time() < fim:
        try:
            dados, end = s.recvfrom(4096)
        except socket.timeout:
            continue
        txt = dados.decode(errors="replace")
        serial = re.search(r"USN:\s*(\S+)", txt)
        if serial and serial.group(1) not in achadas:
            nome = re.search(r"DevName\.bambu\.com:\s*(.+)", txt)
            modelo = re.search(r"DevModel\.bambu\.com:\s*(\S+)", txt)
            achadas[serial.group(1)] = 1
            print(f"- {nome.group(1).strip() if nome else '?'} · modelo {modelo.group(1) if modelo else '?'} · IP {end[0]} · série {serial.group(1)}")
    if not achadas:
        print("Nenhuma encontrada (a impressora precisa estar na mesma rede; alguns roteadores bloqueiam esses anúncios).")


def ciclo(cfg, ads, det: Detector, fila: Fila) -> None:
    estados = []
    for ad in ads:
        try:
            s = ad.get_status()
        except Exception as e:  # noqa: BLE001 — um adaptador com problema não derruba os outros
            log.warning("%s: %s", ad.nome, e)
            s = {"conexao": "offline", "estado": "desconhecido"}
        s = {k: v for k, v in s.items() if v is not None}
        fila.adicionar(det.processar(ad.tipo, ad.dispositivo_id, s))
        estados.append({**ad.get_device_info(), **s, "trabalho_id": det.ant.get(f"{ad.tipo}:{ad.dispositivo_id}", {}).get("trabalho_id"), "medido_em": agora()})
    lote = fila.lote()
    try:
        r = rpc(cfg, "agente_reportar", {"p_token": cfg["token"], "p_dados": {"versao": VERSAO, "impressoras": estados, "eventos": lote}})
        if r and not r.get("ignorado"):
            fila.confirmar({e["id"] for e in lote})
    except RuntimeError as e:
        log.error("Servidor recusou o envio: %s", e)
        if "revogado" in str(e) or "Token inválido" in str(e):
            raise SystemExit("Este agente foi revogado no painel. Gere um novo código e pareie de novo.") from None
    except (urllib.error.URLError, OSError) as e:
        log.warning("Sem conexão com o servidor (%s): %d evento(s) guardado(s) para enviar depois", e, len(fila.itens))


def cmd_rodar(_a):
    cfg = ler_config()
    if not cfg.get("token"):
        raise SystemExit("Pareie o agente primeiro: python3 mrv3d_agente.py parear CODIGO --site https://...")
    ads = criar_adaptadores(cfg)
    for ad in ads:
        ad.connect()
    det, fila = Detector(), Fila()
    log.info("Agente %s rodando com %d impressora(s)", VERSAO, len(ads))
    try:
        while True:
            ciclo(cfg, ads, det, fila)
            time.sleep(INTERVALO)
    except KeyboardInterrupt:
        pass
    finally:
        for ad in ads:
            ad.disconnect()


def main(argv=None):
    PASTA.mkdir(parents=True, exist_ok=True)
    h = logging.handlers.RotatingFileHandler(PASTA / "agente.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[h, logging.StreamHandler()])
    p = argparse.ArgumentParser(description="MRV3D — agente local de monitoramento de impressoras (somente leitura)")
    sub = p.add_subparsers(dest="cmd", required=True)
    x = sub.add_parser("parear", help="liga este agente à sua empresa com o código do painel")
    x.add_argument("codigo")
    x.add_argument("--site", required=True, help="endereço do painel, ex.: https://mrv3dsolutions.tech")
    x.set_defaults(f=cmd_parear)
    x = sub.add_parser("adicionar", help="adiciona uma impressora da rede local")
    x.add_argument("tipo", choices=["bambu", "moonraker", "octoprint"])
    x.add_argument("--nome", required=True)
    x.add_argument("--ip", required=True)
    x.add_argument("--porta", type=int)
    x.add_argument("--serial", help="Bambu: número de série")
    x.add_argument("--codigo", help="Bambu: código de acesso LAN")
    x.add_argument("--api-key", dest="api_key", help="OctoPrint/Moonraker: chave de API")
    x.add_argument("--id", help="identificador no painel (padrão: nome)")
    x.set_defaults(f=lambda a: cmd_adicionar(argparse.Namespace(**{**vars(a), "tipo": "bambu_lan" if a.tipo == "bambu" else a.tipo})))
    sub.add_parser("testar", help="testa a conexão com as impressoras").set_defaults(f=cmd_testar)
    x = sub.add_parser("descobrir", help="procura impressoras Bambu Lab na rede (só escuta)")
    x.add_argument("--segundos", type=int, default=10)
    x.set_defaults(f=cmd_descobrir)
    sub.add_parser("rodar", help="envia o estado das impressoras ao painel continuamente").set_defaults(f=cmd_rodar)
    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
