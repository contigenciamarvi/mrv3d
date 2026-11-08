"use client";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { dataHora } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Kpi, Loading, Modal, Table, Td } from "@/components/ui";

type Uso = { empresa_id: string; nome: string; status: string; usuarios: number; impressoras: number; impressoras_conectadas: number; agentes_ativos: number; agentes_online: number;
  versoes_agente: string | null; projetos: number; orcamentos_30d: number; armazenamento_mb: number; erros_integracao_7d: number };
type Agente = { id: string; nome: string; ativo: boolean; versao: string | null; sistema: string | null; ultimo_contato: string | null; created_at: string; revogado_em: string | null; revogado_por: string | null };

/** Métricas técnicas agregadas — sem acesso a arquivos, clientes, finanças ou credenciais das empresas */
export default function UsoPlataforma() {
  const [lista, setLista] = useState<Uso[] | null>(null);
  const [falha, setFalha] = useState("");
  const [empresa, setEmpresa] = useState<Uso | null>(null);
  const carregar = useCallback(async () => { setFalha(""); try { setLista(await rpc<Uso[]>("admin_uso_empresas")); } catch (e) { setFalha((e as Error).message); } }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const t = (k: keyof Uso) => (lista || []).reduce((s, x) => s + Number(x[k] || 0), 0);
  return (
    <>
      <PageHeader titulo="Uso da plataforma" sub="Métricas técnicas agregadas por empresa. Arquivos, clientes, valores e credenciais dos assinantes não aparecem aqui." />
      {falha && <ErrorBox erro={falha} />}
      {!lista && !falha ? <Loading /> : lista && <>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Empresas" valor={lista.length} /><Kpi label="Impressoras conectadas" valor={`${t("impressoras_conectadas")} / ${t("impressoras")}`} />
          <Kpi label="Agentes online" valor={`${t("agentes_online")} / ${t("agentes_ativos")}`} /><Kpi label="Armazenamento" valor={`${(t("armazenamento_mb") / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`} />
          <Kpi label="Erros de integração (7 dias)" valor={t("erros_integracao_7d")} tom={t("erros_integracao_7d") ? "vermelho" : undefined} />
        </div>
        <Card>{!lista.length ? <Empty texto="Nenhuma empresa" /> : (
          <Table head={["Empresa", "Usuários", "Impressoras", "Conectadas", "Agentes", "Versões do agente", "Projetos", "Orçamentos 30d", "Armazenamento", "Erros 7d", ""]}>{lista.map((e) => (
            <tr key={e.empresa_id}><Td><div className="font-medium">{e.nome}</div><Badge>{e.status}</Badge></Td><Td>{e.usuarios}</Td><Td>{e.impressoras}</Td><Td>{e.impressoras_conectadas}</Td>
              <Td>{e.agentes_online}/{e.agentes_ativos}</Td><Td className="text-xs">{e.versoes_agente || "—"}</Td><Td>{e.projetos}</Td><Td>{e.orcamentos_30d}</Td>
              <Td>{Number(e.armazenamento_mb).toLocaleString("pt-BR")} MB</Td><Td>{e.erros_integracao_7d ? <Badge tom="vermelho">{e.erros_integracao_7d}</Badge> : 0}</Td>
              <Td>{e.agentes_ativos > 0 && <Button size="sm" variant="ghost" onClick={() => setEmpresa(e)}>Agentes</Button>}</Td></tr>))}</Table>)}</Card>
      </>}
      {empresa && <Agentes empresa={empresa} onClose={() => { setEmpresa(null); carregar(); }} />}
    </>
  );
}

function Agentes({ empresa, onClose }: { empresa: Uso; onClose: () => void }) {
  const [lista, setLista] = useState<Agente[] | null>(null);
  const [rev, setRev] = useState<Agente | null>(null);
  const [motivo, setMotivo] = useState("");
  const carregar = useCallback(() => rpc<Agente[]>("admin_agentes", { p_empresa: empresa.empresa_id }).then(setLista).catch(erro), [empresa.empresa_id]);
  useEffect(() => { carregar(); }, [carregar]);
  return (
    <Modal aberto titulo={`Agentes · ${empresa.nome}`} onClose={onClose} largura="max-w-3xl">
      {!lista ? <Loading /> : !lista.length ? <Empty texto="Nenhum agente" /> : (
        <Table head={["Agente", "Versão", "Sistema", "Último contato", "Situação", ""]}>{lista.map((a) => (
          <tr key={a.id}><Td>{a.nome}</Td><Td>{a.versao || "—"}</Td><Td className="text-xs">{a.sistema || "—"}</Td><Td className="text-sm">{dataHora(a.ultimo_contato)}</Td>
            <Td>{a.ativo ? <Badge tom="verde">Ativo</Badge> : <Badge>Revogado{a.revogado_por === "plataforma" ? " (plataforma)" : ""}</Badge>}</Td>
            <Td>{a.ativo && <Button size="sm" variant="danger" onClick={() => { setRev(a); setMotivo(""); }}>Revogar</Button>}</Td></tr>))}</Table>)}
      <Modal aberto={!!rev} titulo="Revogar agente comprometido" onClose={() => setRev(null)}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await rpc("admin_revogar_agente", { p_id: rev!.id, p_motivo: motivo }); toast("Agente revogado"); setRev(null); carregar(); } catch (e2) { erro(e2); } }}>
          <p className="text-sm">O agente <b>{rev?.nome}</b> para de enviar dados na hora. A empresa vê o aviso e precisa parear de novo.</p>
          <Field label="Motivo (fica na auditoria)"><Input required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setRev(null)}>Cancelar</Button><Button type="submit" variant="danger">Revogar</Button></div>
        </form>
      </Modal>
    </Modal>
  );
}
