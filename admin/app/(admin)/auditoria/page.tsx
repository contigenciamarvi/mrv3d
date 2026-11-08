"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { dataHora } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Input, Loading, Select, Table, Td } from "@/components/ui";

type Log = { id: number; email: string | null; acao: string; entidade: string; entidade_id: string | null; empresa_id: string | null; detalhes: unknown; created_at: string };
type Acesso = { id: string; motivo: string; inicio: string; expira_em: string; encerrado_em: string | null; empresas: { nome: string } | null; admin_id: string };

const ACOES: Record<string, string> = {
  insert: "Criou", update: "Alterou", delete: "Excluiu",
  acesso_suporte_iniciado: "Iniciou acesso de suporte", acesso_suporte_encerrado: "Encerrou acesso de suporte",
  motivo_alteracao_assinatura: "Motivo de alteração", usuario_bloqueado: "Bloqueou usuário", usuario_desbloqueado: "Desbloqueou usuário",
};
const ENTIDADES: Record<string, string> = {
  planos: "Plano", assinaturas: "Assinatura", cupons: "Cupom", faturas: "Fatura", equipe_plataforma: "Equipe", empresas: "Empresa",
  empresa_notas_internas: "Nota interna", despesas_plataforma: "Despesa", usuarios: "Usuário",
};
const PAG = 50;

export default function Auditoria() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [erro, setErro] = useState("");
  const [entidade, setEntidade] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setErro("");
    let q = sb().from("auditoria").select("*").order("created_at", { ascending: false }).range(pagina * PAG, pagina * PAG + PAG - 1);
    if (entidade) q = q.eq("entidade", entidade);
    if (busca.trim()) q = q.ilike("email", `%${busca.trim()}%`);
    const [l, a] = await Promise.all([q, sb().from("acessos_suporte").select("id,motivo,inicio,expira_em,encerrado_em,admin_id,empresas(nome)").order("inicio", { ascending: false }).limit(50)]);
    if (l.error) return setErro(l.error.message);
    setLogs(l.data as Log[]); setAcessos((a.data as unknown as Acesso[]) || []);
  }, [entidade, busca, pagina]);
  useEffect(() => { carregar(); }, [carregar]);

  const csv = () => {
    if (!logs) return;
    const linhas = [["data", "usuario", "acao", "entidade", "id", "detalhes"], ...logs.map((l) => [l.created_at, l.email || "", l.acao, l.entidade, l.entidade_id || "", JSON.stringify(l.detalhes ?? "")])];
    const blob = new Blob(["﻿" + linhas.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <>
      <PageHeader titulo="Auditoria e Segurança" sub="Tudo o que a equipe alterou fica registrado e não pode ser apagado" acoes={<Button variant="secondary" onClick={csv} disabled={!logs?.length}>Exportar CSV</Button>} />
      {erro && <ErrorBox erro={erro} onRetry={carregar} />}
      <div className="space-y-6">
        <Card>
          <CardTitle>Acessos de suporte às lojas</CardTitle>
          {!acessos ? <Loading /> : !acessos.length ? <Empty texto="Nenhum acesso de suporte registrado." /> : (
            <Table head={["Empresa", "Motivo", "Início", "Situação"]}>
              {acessos.map((a) => {
                const ativo = !a.encerrado_em && new Date(a.expira_em) > new Date();
                return <tr key={a.id}><Td className="font-medium">{a.empresas?.nome}</Td><Td>{a.motivo}</Td><Td className="whitespace-nowrap">{dataHora(a.inicio)}</Td>
                  <Td>{ativo ? <Badge tom="amarelo">Ativo até {dataHora(a.expira_em)}</Badge> : <Badge>Encerrado</Badge>}</Td></tr>;
              })}
            </Table>
          )}
        </Card>
        <Card>
          <CardTitle>Registro de alterações</CardTitle>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <Input placeholder="Filtrar por e-mail de quem fez" value={busca} onChange={(e) => { setPagina(0); setBusca(e.target.value); }} />
            <Select value={entidade} onChange={(e) => { setPagina(0); setEntidade(e.target.value); }} aria-label="Tipo">
              <option value="">Tudo</option>{Object.entries(ENTIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          {!logs ? <Loading /> : !logs.length ? <Empty texto="Nada registrado." /> : (
            <Table head={["Quando", "Quem", "Ação", "Em", ""]}>
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr><Td className="whitespace-nowrap">{dataHora(l.created_at)}</Td><Td>{l.email || "sistema"}</Td>
                    <Td>{ACOES[l.acao] || l.acao}</Td><Td>{ENTIDADES[l.entidade] || l.entidade}</Td>
                    <Td><button className="text-xs text-brand-600 underline" onClick={() => setAberto(aberto === l.id ? null : l.id)}>{aberto === l.id ? "ocultar" : "detalhes"}</button></Td></tr>
                  {aberto === l.id && <tr><Td className="bg-slate-50 dark:bg-slate-800/50"><span /></Td><td colSpan={4} className="bg-slate-50 px-3 py-2 dark:bg-slate-800/50"><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(l.detalhes, null, 2)}</pre></td></tr>}
                </Fragment>
              ))}
            </Table>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
            <Button size="sm" variant="secondary" disabled={(logs?.length || 0) < PAG} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
          </div>
        </Card>
      </div>
    </>
  );
}
