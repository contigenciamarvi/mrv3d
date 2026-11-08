"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { brl, data, pode, STATUS_ASSINATURA } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Table, Td, Textarea, tomStatus } from "@/components/ui";

type Plano = {
  id?: string; nome: string; slug: string; descricao: string | null; preco_mensal: number; preco_anual: number | null;
  limite_impressoras: number | null; limite_usuarios: number | null; armazenamento_mb: number | null; dias_teste: number;
  recursos: string[]; ativo: boolean; descontinuado: boolean; ordem: number;
};
type Assin = { id: string; status: string; valor: number; desconto_percentual: number; periodicidade: string; teste_ate: string | null; proxima_cobranca: string | null; empresas: { nome: string } | null; planos: { nome: string } | null };

const RECURSOS: Record<string, string> = {
  clientes: "Clientes", produtos: "Produtos", orcamentos: "Orçamentos", pedidos: "Pedidos", estoque_basico: "Estoque básico",
  ordens_producao: "Ordens de produção", financeiro: "Financeiro", relatorios: "Relatórios", manutencao: "Manutenção",
  automacoes: "Automações", integracoes: "Integrações", relatorios_avancados: "Relatórios avançados", suporte_prioritario: "Suporte prioritário",
};

const vazio: Plano = { nome: "", slug: "", descricao: "", preco_mensal: 0, preco_anual: null, limite_impressoras: null, limite_usuarios: null, armazenamento_mb: 1024, dias_teste: 14, recursos: [], ativo: true, descontinuado: false, ordem: 10 };

export default function Planos() {
  const { papel } = useSessao();
  const [planos, setPlanos] = useState<Plano[] | null>(null);
  const [assin, setAssin] = useState<Assin[] | null>(null);
  const [erroTxt, setErro] = useState("");
  const [editando, setEditando] = useState<Plano | null>(null);
  const [filtro, setFiltro] = useState("");

  const carregar = useCallback(async () => {
    setErro("");
    const [p, a] = await Promise.all([
      sb().from("planos").select("*").order("ordem"),
      sb().from("assinaturas").select("id,status,valor,desconto_percentual,periodicidade,teste_ate,proxima_cobranca,empresas(nome),planos(nome)").order("created_at", { ascending: false }),
    ]);
    if (p.error || a.error) return setErro((p.error || a.error)!.message);
    setPlanos(p.data as Plano[]); setAssin(a.data as unknown as Assin[]);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    (assin || []).forEach((a) => { if (a.status !== "cancelada" && a.planos) c[a.planos.nome] = (c[a.planos.nome] || 0) + 1; });
    return c;
  }, [assin]);

  return (
    <>
      <PageHeader titulo="Planos e Assinaturas" sub="Preços, limites e recursos de cada plano"
        acoes={pode(papel, "gerirPlanos") && <Button onClick={() => setEditando({ ...vazio })}>Novo plano</Button>} />
      {erroTxt && <ErrorBox erro={erroTxt} onRetry={carregar} />}
      <Solicitacoes podeGerir={pode(papel, "gerirAssinaturas")} />
      {!planos ? <Loading /> : (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          {planos.map((p) => (
            <Card key={p.id} className={p.descontinuado || !p.ativo ? "opacity-70" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-lg font-semibold">{p.nome}</div><div className="text-xs text-slate-500">{contagem[p.nome] || 0} assinatura(s) vigentes</div></div>
                {p.descontinuado ? <Badge tom="amarelo">Descontinuado</Badge> : !p.ativo ? <Badge>Inativo</Badge> : <Badge tom="verde">Ativo</Badge>}
              </div>
              <div className="tnum mt-3 text-2xl font-semibold">{brl(p.preco_mensal)}<span className="text-sm font-normal text-slate-500">/mês</span></div>
              {p.preco_anual != null && <div className="text-sm text-slate-500">{brl(p.preco_anual)}/ano</div>}
              <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <li>Até {p.limite_impressoras ?? "∞"} impressoras · {p.limite_usuarios ?? "∞"} usuário(s)</li>
                <li>{p.armazenamento_mb ? `${(p.armazenamento_mb / 1024).toLocaleString("pt-BR")} GB` : "∞"} de armazenamento · {p.dias_teste} dias de teste</li>
                <li className="text-xs text-slate-500">{p.recursos.map((r) => RECURSOS[r] || r).join(" · ")}</li>
              </ul>
              {pode(papel, "gerirPlanos") && <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEditando({ ...p })}>Editar</Button>}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardTitle right={<Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-auto" aria-label="Status">
          <option value="">Todos os status</option>{Object.entries(STATUS_ASSINATURA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>Assinaturas</CardTitle>
        {!assin ? <Loading /> : !assin.filter((a) => !filtro || a.status === filtro).length ? <Empty texto="Nenhuma assinatura." /> : (
          <Table head={["Empresa", "Plano", "Status", "Valor", "Teste até", "Próxima cobrança"]}>
            {assin.filter((a) => !filtro || a.status === filtro).map((a) => (
              <tr key={a.id}><Td className="font-medium">{a.empresas?.nome}</Td><Td>{a.planos?.nome} <span className="text-xs text-slate-500">({a.periodicidade})</span></Td>
                <Td><Badge tom={tomStatus(a.status)}>{STATUS_ASSINATURA[a.status]}</Badge></Td>
                <Td className="tnum">{brl(a.valor)}{a.desconto_percentual > 0 && <span className="text-xs text-emerald-600"> −{a.desconto_percentual}%</span>}</Td>
                <Td className="tnum">{data(a.teste_ate)}</Td><Td className="tnum">{data(a.proxima_cobranca)}</Td></tr>
            ))}
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">Para trocar plano, suspender, conceder teste ou desconto de uma empresa, abra a empresa em <b>Empresas → Assinatura</b>.</p>
      </Card>

      {editando && <EditorPlano plano={editando} onClose={() => setEditando(null)} onOk={carregar} />}
    </>
  );
}

function EditorPlano({ plano, onClose, onOk }: { plano: Plano; onClose: () => void; onOk: () => void }) {
  const [p, setP] = useState<Plano>(plano);
  const [salvando, setSalvando] = useState(false);
  const num = (v: string) => (v === "" ? null : Number(v));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = (p.slug || p.nome).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    if (!slug) return toast("Informe o nome do plano", "erro");
    setSalvando(true);
    const dados = { ...p, slug, descricao: p.descricao || null };
    delete (dados as Partial<Plano>).id;
    const r = plano.id ? await sb().from("planos").update(dados).eq("id", plano.id) : await sb().from("planos").insert(dados);
    setSalvando(false);
    if (r.error) return erro(r.error);
    toast(plano.id ? "Plano atualizado. Assinaturas existentes mantêm o valor contratado." : "Plano criado"); onOk(); onClose();
  };
  const alternar = (r: string) => setP({ ...p, recursos: p.recursos.includes(r) ? p.recursos.filter((x) => x !== r) : [...p.recursos, r] });
  return (
    <Modal aberto titulo={plano.id ? `Editar ${plano.nome}` : "Novo plano"} onClose={onClose} largura="max-w-2xl">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input required value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} /></Field>
          <Field label="Ordem de exibição"><Input type="number" value={p.ordem} onChange={(e) => setP({ ...p, ordem: Number(e.target.value) })} /></Field>
          <Field label="Preço mensal (R$)"><Input type="number" step="0.01" min={0} required value={p.preco_mensal} onChange={(e) => setP({ ...p, preco_mensal: Number(e.target.value) })} /></Field>
          <Field label="Preço anual (R$)" hint="Vazio = 12× o mensal"><Input type="number" step="0.01" min={0} value={p.preco_anual ?? ""} onChange={(e) => setP({ ...p, preco_anual: num(e.target.value) })} /></Field>
          <Field label="Limite de impressoras" hint="Vazio = ilimitado"><Input type="number" min={1} value={p.limite_impressoras ?? ""} onChange={(e) => setP({ ...p, limite_impressoras: num(e.target.value) })} /></Field>
          <Field label="Limite de usuários" hint="Vazio = ilimitado"><Input type="number" min={1} value={p.limite_usuarios ?? ""} onChange={(e) => setP({ ...p, limite_usuarios: num(e.target.value) })} /></Field>
          <Field label="Armazenamento (MB)"><Input type="number" min={1} value={p.armazenamento_mb ?? ""} onChange={(e) => setP({ ...p, armazenamento_mb: num(e.target.value) })} /></Field>
          <Field label="Dias de teste"><Input type="number" min={0} max={90} value={p.dias_teste} onChange={(e) => setP({ ...p, dias_teste: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Descrição"><Textarea value={p.descricao || ""} onChange={(e) => setP({ ...p, descricao: e.target.value })} /></Field>
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">Recursos incluídos</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(RECURSOS).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.recursos.includes(k)} onChange={() => alternar(k)} className="h-4 w-4 accent-blue-600" />{v}</label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.ativo} onChange={(e) => setP({ ...p, ativo: e.target.checked })} className="h-4 w-4 accent-blue-600" /> Ativo (visível para novos clientes)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={p.descontinuado} onChange={(e) => setP({ ...p, descontinuado: e.target.checked })} className="h-4 w-4 accent-blue-600" /> Descontinuado (assinantes atuais continuam)</label>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}>Salvar</Button></div>
      </form>
    </Modal>
  );
}

type Solic = { id: string; tipo: string; status: string; motivo: string | null; resposta: string | null; created_at: string; empresa_id: string; empresas: { nome: string } | null; planos: { nome: string } | null; periodicidade: string | null };
const TIPO_SOLIC: Record<string, string> = { upgrade: "Upgrade", downgrade: "Downgrade", cancelamento: "Cancelamento", periodicidade: "Mudar periodicidade" };

/** Pedidos feitos pelos assinantes em "Minha Assinatura" — a mudança em si é feita na empresa (aba Assinatura) */
function Solicitacoes({ podeGerir }: { podeGerir: boolean }) {
  const [lista, setLista] = useState<Solic[] | null>(null);
  const [resp, setResp] = useState<{ s: Solic; status: string; texto: string } | null>(null);
  const carregar = useCallback(async () => {
    const { data: d, error } = await sb().from("solicitacoes_assinatura").select("id,tipo,status,motivo,resposta,created_at,empresa_id,periodicidade,empresas(nome),planos(nome)").order("created_at", { ascending: false }).limit(100);
    if (error) { erro(new Error(error.message)); return; }
    setLista(d as unknown as Solic[]);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const pend = (lista || []).filter((s) => s.status === "pendente");
  if (!lista || !lista.length) return null;
  return (
    <Card className="mb-6">
      <CardTitle>Solicitações dos assinantes {pend.length > 0 && <Badge tom="amarelo">{pend.length} pendente(s)</Badge>}</CardTitle>
      <Table head={["Quando", "Empresa", "Pedido", "Motivo", "Situação", ""]}>
        {lista.slice(0, 20).map((s) => (
          <tr key={s.id}><Td>{data(s.created_at)}</Td><Td><a className="text-blue-600 underline" href={`/empresas/?q=${encodeURIComponent(s.empresas?.nome || "")}`}>{s.empresas?.nome}</a></Td>
            <Td>{TIPO_SOLIC[s.tipo]}{s.planos && ` → ${s.planos.nome}`}{s.periodicidade && s.tipo === "periodicidade" && ` → ${s.periodicidade}`}</Td><Td className="max-w-60 text-slate-500">{s.motivo || "—"}</Td>
            <Td><Badge tom={s.status === "atendida" ? "verde" : s.status === "pendente" ? "amarelo" : "cinza"}>{s.status}</Badge></Td>
            <Td>{podeGerir && s.status === "pendente" && <div className="flex gap-1"><Button size="sm" onClick={() => setResp({ s, status: "atendida", texto: "" })}>Atendida</Button><Button size="sm" variant="secondary" onClick={() => setResp({ s, status: "recusada", texto: "" })}>Recusar</Button></div>}</Td></tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-slate-500">Para aplicar a mudança, abra a empresa → aba Assinatura. Depois marque a solicitação como atendida.</p>
      <Modal aberto={!!resp} titulo={resp?.status === "atendida" ? "Marcar como atendida" : "Recusar solicitação"} onClose={() => setResp(null)}>
        {resp && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const { data: u } = await sb().auth.getUser();
          const { error } = await sb().from("solicitacoes_assinatura").update({ status: resp.status, resposta: resp.texto || null, resolvido_em: new Date().toISOString(), resolvido_por: u.user?.id }).eq("id", resp.s.id);
          if (error) { erro(new Error(error.message)); return; } toast("Solicitação atualizada"); setResp(null); carregar(); }}>
          <Field label="Resposta para o assinante"><Textarea value={resp.texto} onChange={(e) => setResp({ ...resp, texto: e.target.value })} placeholder="Ex.: Plano alterado, a próxima fatura já vem com o novo valor." /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setResp(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>
    </Card>
  );
}
