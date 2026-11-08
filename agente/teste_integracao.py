"""Integração SIMULADA agente → banco local de testes (sem impressora e sem PostgREST).
Pré-requisito: db/teste/rodar.sh executado (banco local em /tmp/pg:5499)."""
import importlib.util, json, os, subprocess, tempfile
from pathlib import Path

os.environ["MRV3D_AGENTE_DIR"] = tempfile.mkdtemp()
spec = importlib.util.spec_from_file_location("ag", Path(__file__).resolve().parent.parent / "painel/public/agente/mrv3d_agente.py")
ag = importlib.util.module_from_spec(spec); spec.loader.exec_module(ag)
PSQL = ["psql", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", "t", "-AtqX", "-v", "ON_ERROR_STOP=1"]

def sql(q, *args):
    return subprocess.run(PSQL + ["-c", q], capture_output=True, text=True, check=True).stdout.strip()

emp = sql("select id from public.empresas where nome = 'Loja A'")
sql(f"update public.planos set limite_agentes = null, limite_impressoras_conectadas = null")
cod = sql(f"set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a'; select public.criar_pareamento('{emp}', 'Integração')->>'codigo'").splitlines()[-1]

def rpc_local(_cfg, nome, args):
    payload = json.dumps(args).replace("'", "''")
    fn = {"agente_parear": "public.agente_parear(%s->>'p_codigo', %s->'p_dados')", "agente_reportar": "public.agente_reportar(%s->>'p_token', %s->'p_dados')"}[nome]
    arg = f"'{payload}'::jsonb"
    sql("update public.agentes_locais set ultimo_contato = now() - interval '1 minute' where ultimo_contato is not null")
    out = sql("set role anon; select " + fn % (arg, arg))
    return json.loads(out.splitlines()[-1])

ag.rpc = rpc_local
cfg = {"servidor": "https://teste", "chave_publica": "x"}
tok = rpc_local(cfg, "agente_parear", {"p_codigo": cod, "p_dados": {"versao": ag.VERSAO}})["token"]
cfg["token"] = tok
sql(f"insert into public.impressoras(empresa_id, nome, conexao_tipo, dispositivo_id) values ('{emp}', 'Voron sim', 'moonraker', 'voron-sim')")

class Simulada(ag.PrinterAdapter):
    tipo = "moonraker"
    def __init__(self):
        super().__init__({"nome": "Voron sim", "dispositivo_id": "voron-sim", "host": "192.168.0.9"})
        self.seq = iter([
            {"conexao": "online", "estado": "disponivel"},
            {"conexao": "online", "estado": "imprimindo", "arquivo": "caixa.gcode", "progresso": 10, "temp_bico": 215},
            {"conexao": "online", "estado": "imprimindo", "arquivo": "caixa.gcode", "progresso": 80},
            {"conexao": "online", "estado": "concluida", "progresso": 100, "decorrido_s": 3600},
        ])
    def get_status(self):
        return next(self.seq)

ad, det, fila = Simulada(), ag.Detector(), ag.Fila()
for _ in range(4):
    ag.ciclo(cfg, [ad], det, fila)
assert not fila.itens, "todos os eventos confirmados"
tr = sql("select t.status || '|' || duracao_s || '|' || arquivo from public.impressora_trabalhos t join public.impressoras i on i.id = t.impressora_id where i.dispositivo_id = 'voron-sim'")
assert tr == "concluido|3600|caixa.gcode", tr
tel = sql("select estado || '|' || progresso from public.impressora_telemetria t join public.impressoras i on i.id = t.impressora_id where i.dispositivo_id = 'voron-sim'")
assert tel == "concluida|100.00", tel
ev = sql("select string_agg(tipo, ',' order by ocorrido_em) from public.impressora_eventos_integracao e join public.impressoras i on i.id = e.impressora_id where i.dispositivo_id = 'voron-sim'")
assert ev == "conectada,impressao_iniciada,impressao_concluida", ev
print("INTEGRAÇÃO AGENTE OK (simulada):", tr, "|", ev)
