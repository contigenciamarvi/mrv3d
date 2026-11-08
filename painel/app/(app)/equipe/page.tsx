"use client";
import { useState } from "react";
import { UserPlus, Pencil, Trash2 } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { dataHora, data, PAPEIS_EMPRESA, PERMISSOES } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Tabs, Checkbox, Confirmar, Aviso } from "@/components/ui";

type Membro = { user_id: string; email: string; papel: string; ativo: boolean; permissoes_extra: string[]; permissoes_removidas: string[]; desde: string; ultimo_acesso: string | null };
// espelho de private.permissoes_papel (o banco é quem decide)
const BASE: Record<string, string[]> = {
  comercial: ["clientes_ver", "clientes_editar", "orcamentos_ver", "orcamentos_criar", "pedidos_ver", "pedidos_editar", "produtos_ver", "materia_ver", "impressoras_ver", "custos_ver"],
  producao: ["clientes_ver", "orcamentos_ver", "pedidos_ver", "producao_gerenciar", "impressoras_ver", "impressoras_editar", "materia_ver", "materia_movimentar", "produtos_ver"],
  estoque: ["materia_ver", "materia_editar", "materia_movimentar", "produtos_ver", "impressoras_ver", "compras_gerenciar"],
  financeiro: ["clientes_ver", "orcamentos_ver", "pedidos_ver", "pedidos_editar", "custos_ver", "financeiro_ver", "compras_gerenciar", "relatorios_ver", "produtos_ver", "materia_ver"],
  expedicao: ["clientes_ver", "pedidos_ver", "expedicao_gerenciar", "produtos_ver"],
  operador: ["clientes_ver", "clientes_editar", "pedidos_ver", "pedidos_editar", "materia_ver", "materia_movimentar", "produtos_ver", "impressoras_ver", "orcamentos_ver", "orcamentos_criar"],
};
const PAPEIS_ESCOLHA = ["admin", "comercial", "producao", "estoque", "financeiro", "expedicao"];
const ACOES: Record<string, string> = { insert: "criou", update: "alterou", delete: "excluiu" };
const ENTIDADES: Record<string, string> = { clientes: "cliente", pedidos: "pedido", materiais: "matéria-prima", impressoras: "impressora", produtos: "produto", orcamentos: "orçamento", membros: "membro da equipe", empresas: "dados da empresa", empresa_config: "configurações", assinaturas: "assinatura" };

export default function Equipe() {
  const app = useApp();
  const admin = app.pode("usuarios_admin") && app.podeEscrever;
  const [aba, setAba] = useState<"equipe" | "auditoria">("equipe");
  const [novo, setNovo] = useState<{ email: string; papel: string } | null>(null);
  const [editar, setEditar] = useState<Membro | null>(null);
  const [remover, setRemover] = useState<Membro | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [membros, assin] = await Promise.all([rpc<Membro[]>("equipe_listar", { p_empresa: app.empresa.id }), rpc<{ plano: { limite_usuarios: number } | null }>("minha_assinatura", { p_empresa: app.empresa.id })]);
    return { membros, limite: assin.plano?.limite_usuarios };
  }, [app.empresa.id]);
  const ativos = (dados?.membros || []).filter((m) => m.ativo).length;

  return (
    <>
      <PageHeader titulo="Equipe e Permissões" sub={dados?.limite ? `${ativos} de ${dados.limite} usuário(s) do seu plano` : undefined}
        acoes={admin && <Button onClick={() => setNovo({ email: "", papel: "comercial" })} disabled={!!dados?.limite && ativos >= dados.limite}><UserPlus className="h-4 w-4" /> Adicionar pessoa</Button>} />
      {app.pode("usuarios_admin") && <Tabs abas={[["equipe", "Equipe"], ["auditoria", "Registro de alterações"]]} ativa={aba} onChange={setAba} />}
      {aba === "auditoria" ? <Auditoria /> : (
        <Card>
          {dados?.limite && ativos >= dados.limite && admin && <div className="mb-4"><Aviso tom="amarelo">Você atingiu o limite de usuários do plano. Faça upgrade em Minha Assinatura para adicionar mais pessoas.</Aviso></div>}
          {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
          {carregando && !dados ? <Loading /> : !dados?.membros.length ? <Empty texto="Ninguém na equipe" /> : (
            <Table head={["Pessoa", "Perfil", "Desde", "Último acesso", ""]}>
              {dados.membros.map((m) => (
                <tr key={m.user_id} className={m.ativo ? "" : "opacity-50"}>
                  <Td><div className="font-medium">{m.email}{m.user_id === app.userId && <span className="ml-2 text-xs text-slate-400">(você)</span>}</div>
                    {(m.permissoes_extra.length > 0 || m.permissoes_removidas.length > 0) && <div className="text-xs text-slate-500">permissões personalizadas</div>}</Td>
                  <Td><Badge tom={m.papel === "dono" ? "azul" : "cinza"}>{PAPEIS_EMPRESA[m.papel]}</Badge>{!m.ativo && <Badge tom="amarelo">desativado</Badge>}</Td>
                  <Td>{data(m.desde)}</Td><Td>{dataHora(m.ultimo_acesso)}</Td>
                  <Td>{admin && m.papel !== "dono" && m.user_id !== app.userId && <div className="flex justify-end gap-1">
                    <button onClick={() => setEditar(m)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setRemover(m)} className="rounded p-1.5 text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>
                  </div>}</Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries({ admin: "Tudo, exceto mudar o proprietário.", comercial: "Clientes, orçamentos e pedidos.", producao: "Impressoras, matéria-prima e produção.",
              estoque: "Matéria-prima, compras e produtos.", financeiro: "Financeiro, compras, custos e relatórios.", expedicao: "Pedidos prontos e entregas." }).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><div className="font-medium">{PAPEIS_EMPRESA[k]}</div><div className="text-slate-500">{v}</div></div>
            ))}
          </div>
        </Card>
      )}
      <Modal aberto={!!novo} titulo="Adicionar pessoa" onClose={() => setNovo(null)}>
        {novo && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await rpc("equipe_adicionar", { p_empresa: app.empresa.id, p_email: novo.email, p_papel: novo.papel }); toast("Pessoa adicionada"); setNovo(null); recarregar(); } catch (e2) { erro(e2); } }}>
          <Aviso>A pessoa precisa ter criado uma conta em mrv3dsolutions.tech com este e-mail. Depois de adicionada, ela vê a sua empresa ao entrar.</Aviso>
          <Field label="E-mail"><Input required type="email" autoFocus value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></Field>
          <Field label="Perfil"><Select value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>{PAPEIS_ESCOLHA.map((p) => <option key={p} value={p}>{PAPEIS_EMPRESA[p]}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNovo(null)}>Cancelar</Button><Button type="submit">Adicionar</Button></div>
        </form>}
      </Modal>
      {editar && <EditarMembro m={editar} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); recarregar(); }} />}
      <Confirmar aberto={!!remover} titulo="Remover da equipe" perigo confirmar="Remover" onCancel={() => setRemover(null)}
        onOk={async () => { try { await rpc("equipe_remover", { p_empresa: app.empresa.id, p_user: remover!.user_id }); toast("Pessoa removida"); setRemover(null); recarregar(); } catch (e) { erro(e); } }}
        texto={<><b>{remover?.email}</b> perde o acesso à empresa. O que ela registrou continua salvo.</>} />
    </>
  );
}

function EditarMembro({ m, onClose, onSalvo }: { m: Membro; onClose: () => void; onSalvo: () => void }) {
  const app = useApp();
  const [papel, setPapel] = useState(m.papel);
  const [extra, setExtra] = useState<string[]>(m.permissoes_extra);
  const [removidas, setRemovidas] = useState<string[]>(m.permissoes_removidas);
  const [ativo, setAtivo] = useState(m.ativo);
  const base = papel === "admin" ? Object.keys(PERMISSOES) : BASE[papel] || [];
  const tem = (p: string) => (base.includes(p) || extra.includes(p)) && !removidas.includes(p);
  const alternar = (p: string, v: boolean) => {
    if (v) { setRemovidas(removidas.filter((x) => x !== p)); if (!base.includes(p)) setExtra([...new Set([...extra, p])]); }
    else { setExtra(extra.filter((x) => x !== p)); if (base.includes(p)) setRemovidas([...new Set([...removidas, p])]); }
  };
  return (
    <Modal aberto titulo={m.email} onClose={onClose} largura="max-w-2xl">
      <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); try { await rpc("equipe_alterar", { p_empresa: app.empresa.id, p_user: m.user_id, p_papel: papel, p_extra: extra, p_removidas: removidas, p_ativo: ativo }); toast("Permissões salvas"); onSalvo(); } catch (e2) { erro(e2); } }}>
        <Field label="Perfil"><Select value={papel} onChange={(e) => { setPapel(e.target.value); setExtra([]); setRemovidas([]); }}>{PAPEIS_ESCOLHA.map((p) => <option key={p} value={p}>{PAPEIS_EMPRESA[p]}</option>)}</Select></Field>
        {papel !== "admin" && <>
          <div className="text-sm font-medium">Permissões <span className="font-normal text-slate-500">— ajuste fino a partir do perfil</span></div>
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(PERMISSOES).map(([k, v]) => <Checkbox key={k} label={v} checked={tem(k)} onChange={(x) => alternar(k, x)} hint={base.includes(k) ? undefined : "fora do perfil"} />)}</div>
        </>}
        <Checkbox label="Acesso ativo" hint="Desative para bloquear sem remover" checked={ativo} onChange={setAtivo} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Salvar</Button></div>
      </form>
    </Modal>
  );
}

function Auditoria() {
  const app = useApp();
  const [pagina, setPagina] = useState(0);
  const { dados, carregando } = useDados(() => q<{ id: number; email: string | null; acao: string; entidade: string; detalhes: Record<string, unknown>; created_at: string }[]>(
    sb().from("auditoria").select("id,email,acao,entidade,detalhes,created_at").eq("empresa_id", app.empresa.id).order("id", { ascending: false }).range(pagina * 50, pagina * 50 + 49)), [app.empresa.id, pagina]);
  return (
    <Card>
      {carregando && !dados ? <Loading /> : !dados?.length ? <Empty texto="Nenhum registro" /> : (
        <Table head={["Quando", "Quem", "O quê", "Detalhe"]}>
          {dados.map((a) => {
            const nome = (a.detalhes?.nome ?? a.detalhes?.titulo ?? a.detalhes?.descricao) as string | undefined;
            const campos = a.acao === "update" ? Object.keys(a.detalhes || {}).join(", ") : nome;
            return <tr key={a.id}><Td className="whitespace-nowrap">{dataHora(a.created_at)}</Td><Td>{a.email || "sistema / link"}</Td>
              <Td>{ACOES[a.acao] || a.acao} {ENTIDADES[a.entidade] || a.entidade}</Td><Td className="max-w-80 truncate text-slate-500" >{typeof campos === "string" ? campos : ""}</Td></tr>;
          })}
        </Table>
      )}
      <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="secondary" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Mais recentes</Button>
        <Button size="sm" variant="secondary" disabled={(dados?.length || 0) < 50} onClick={() => setPagina(pagina + 1)}>Mais antigos</Button></div>
    </Card>
  );
}
