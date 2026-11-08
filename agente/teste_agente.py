"""Testes do agente local com dados SIMULADOS (sem impressora real). Rodar: python3 agente/teste_agente.py"""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["MRV3D_AGENTE_DIR"] = tempfile.mkdtemp()
spec = importlib.util.spec_from_file_location("ag", Path(__file__).resolve().parent.parent / "painel/public/agente/mrv3d_agente.py")
ag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ag)


class Normalizacao(unittest.TestCase):
    def test_bambu(self):
        s = ag.normalizar_bambu({"gcode_state": "RUNNING", "mc_percent": 42, "mc_remaining_time": 35, "nozzle_temper": 220.4, "bed_temper": 9999,
                                 "subtask_name": "suporte", "job_id": "123", "print_error": 0,
                                 "ams": {"ams": [{"tray": [{"tray_type": "PLA", "tray_color": "FFFFFFFF"}, {"tray_type": ""}]}]}})
        self.assertEqual(s["estado"], "imprimindo")
        self.assertEqual(s["restante_s"], 2100)
        self.assertEqual(s["temp_bico"], 220.4)
        self.assertIsNone(s["temp_mesa"])  # fora da faixa: descartado
        self.assertEqual(s["trabalho_id"], "123")
        self.assertEqual(s["ams"], [{"tipo": "PLA", "cor": "FFFFFFFF"}])
        self.assertIsNone(s["erro_codigo"])
        self.assertEqual(ag.normalizar_bambu({"gcode_state": "FAILED", "print_error": 50348044})["erro_codigo"], "0300400C")
        self.assertEqual(ag.normalizar_bambu({})["estado"], "desconhecido")

    def test_moonraker(self):
        s = ag.normalizar_moonraker({"status": {"print_stats": {"state": "printing", "filename": "caixa.gcode", "print_duration": 600},
                                                "virtual_sdcard": {"progress": 0.25}, "extruder": {"temperature": 210, "target": 210},
                                                "heater_bed": {"temperature": 60, "target": 60}}})
        self.assertEqual((s["estado"], s["progresso"], s["decorrido_s"], s["restante_s"]), ("imprimindo", 25.0, 600, 1800))
        self.assertEqual(ag.normalizar_moonraker({"print_stats": {"state": "complete"}})["estado"], "concluida")

    def test_octoprint(self):
        s = ag.normalizar_octoprint({"state": {"flags": {"printing": True, "operational": True}}, "temperature": {"tool0": {"actual": 200, "target": 200}, "bed": {"actual": 55}}},
                                    {"job": {"file": {"name": "peca.gcode"}}, "progress": {"completion": 50.5, "printTime": 100, "printTimeLeft": 98}})
        self.assertEqual((s["estado"], s["arquivo"], s["progresso"], s["restante_s"]), ("imprimindo", "peca.gcode", 50.5, 98))
        self.assertEqual(ag.normalizar_octoprint({"state": {"flags": {"closedOrError": True}}}, {})["estado"], "erro")


class Eventos(unittest.TestCase):
    def tipos(self, det, *leituras):
        out = []
        for s in leituras:
            out += [e["tipo"] for e in det.processar("moonraker", "voron", s)]
        return out

    def test_ciclo_completo(self):
        d = ag.Detector()
        t = self.tipos(d, {"conexao": "online", "estado": "disponivel"}, {"conexao": "online", "estado": "imprimindo", "arquivo": "a.gcode"},
                       {"conexao": "online", "estado": "pausada"}, {"conexao": "online", "estado": "imprimindo"}, {"conexao": "online", "estado": "concluida", "progresso": 100},
                       {"conexao": "online", "estado": "disponivel"})
        self.assertEqual(t, ["conectada", "impressao_iniciada", "impressao_pausada", "impressao_retomada", "impressao_concluida"])

    def test_falha_desconexao_e_temperatura(self):
        d = ag.Detector()
        t = self.tipos(d, {"conexao": "online", "estado": "imprimindo"}, {"conexao": "online", "estado": "imprimindo", "temp_bico": 300, "temp_bico_alvo": 220},
                       {"conexao": "online", "estado": "imprimindo", "temp_bico": 301, "temp_bico_alvo": 220},
                       {"conexao": "online", "estado": "falha"}, {"conexao": "offline", "estado": "desconhecido"}, {"conexao": "erro_autenticacao", "estado": "desconhecido"})
        self.assertEqual(t, ["conectada", "impressao_iniciada", "temperatura_anormal", "impressao_falhou", "desconectada", "erro_autenticacao"])

    def test_voltou_disponivel_sem_dizer(self):
        d = ag.Detector()
        t = self.tipos(d, {"conexao": "online", "estado": "imprimindo", "progresso": 30}, {"conexao": "online", "estado": "disponivel"})
        self.assertEqual(t[-1], "impressao_cancelada")  # parou em 30%: não é conclusão

    def test_ids_unicos(self):
        d = ag.Detector()
        e1 = d.processar("bambu_lan", "X", {"conexao": "online", "estado": "imprimindo"})
        self.assertEqual(len({e["id"] for e in e1}), len(e1))


class FilaOffline(unittest.TestCase):
    def test_limite_e_confirmacao(self):
        f = ag.Fila(Path(tempfile.mkdtemp()) / "f.json", maximo=3)
        f.adicionar([{"id": str(i)} for i in range(5)])
        self.assertEqual([e["id"] for e in f.itens], ["2", "3", "4"])  # mantém os mais novos
        f.confirmar({"2", "3"})
        self.assertEqual([e["id"] for e in f.itens], ["4"])
        self.assertEqual([e["id"] for e in ag.Fila(f.caminho).itens], ["4"])  # sobrevive a reinício


class Seguranca(unittest.TestCase):
    def test_ssrf(self):
        self.assertTrue(ag.host_permitido("192.168.0.50"))
        self.assertTrue(ag.host_permitido("10.1.2.3"))
        self.assertFalse(ag.host_permitido("8.8.8.8"))
        self.assertFalse(ag.host_permitido("127.0.0.1"))
        self.assertFalse(ag.host_permitido("169.254.169.254"))  # metadados de nuvem
        self.assertTrue(ag.host_permitido("8.8.8.8", permitir_publico=True))

    def test_config_privada(self):
        ag.salvar_config({"token": "x", "impressoras": []})
        if os.name == "posix":
            self.assertEqual(oct(ag.CONFIG.stat().st_mode & 0o777), "0o600")

    def test_slug(self):
        self.assertEqual(ag.slug("Voron 2.4 / sala"), "Voron-2.4-sala")
        self.assertRegex(ag.slug("!!"), r"^[A-Za-z0-9._-]{3,64}$")


if __name__ == "__main__":
    unittest.main(verbosity=1)
