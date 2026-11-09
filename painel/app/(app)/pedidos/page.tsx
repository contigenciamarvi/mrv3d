"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, MessageCircle, Printer, Ban, Undo2, Factory, Trash2 } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import {
  brl, num, data, dataHora, hojeISO, numOuNull, linkWhats, preencher, TIPOS_SERVICO, STATUS_PAGAMENTO, STATUS_PRODUCAO, STATUS_ENTREGA, STATUS_OP,
  FORMAS_PAGAMENTO, etapaPedido, cn,
} from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Kpi, Confirmar, Paginacao, Tabs, Aviso } from "@/components/ui";

type Pedido = {
  id: string; numero: number; descricao: string | null; status: string; status_pagamento: string; status_producao: string; status_entrega: string;
  tipo_servico: string; valor_total: number; valor_pago: number; custo_estimado: number | null; custo_real: number; impostos_estimados: number;
  data_entrega: string | null; origem: string; forma_pagamento: string | null; observacoes: string | null; transportadora: string | null; codigo_rastreio: string | null;
  entregue_em: string | null; motivo_cancelamento: string | null; created_at: string; cliente_id: string | null; orcamento_id: string | null;
  clientes: { nome: string; whatsapp: string | null; telefone: string | null } | null; links_acesso: { nome: string } | null;
};
const SEL = "id,numero,descricao,status,status_pagamento,status_producao,status_entrega,tipo_servico,valor_total,valor_pago,custo_estimado,custo_real,impostos_estimados,data_entrega,origem,forma_pagamento,observacoes,transportadora,codigo_rastreio,entregue_em,motivo_cancelamento,created_at,cliente_id,orcamento_id,clientes(nome,whatsapp,telefone),links_acesso(nome)";

export default function Pedidos() { return <Exige perm="pedidos_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.pode("pedidos_editar") && app.podeEscrever;
  const idUrl = useParam("id");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("abertos");
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState<Record<string, string> | null>(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [peds, clis] = await Promise.all([
      q<Pedido[]>(sb().from("pedidos").select(SEL).eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(3000)),
      app.pode("clientes_ver") ? q<{ id: string; nome: string }[]>(sb().from("clientes").select("id,nome").eq("empresa_id", app.empresa.id).eq("arquivado", false).order("nome")) : Promise.resolve([]),
    ]);
    return { peds, clis };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl) setDetalhe(idUrl); }, [idUrl]);

  const hoje = hojeISO();
  const aberto = (p: Pedido) => p.status !== "cancelado" && !["entregue", "retirado"].includes(p.status_entrega);
  const atrasado = (p: Pedido) => aberto(p) && !!p.data_entrega && p.data_entrega < hoje;
  const lista = useMemo(() => (dados?.peds || []).filter((p) => {
    const t = busca.trim().toLowerCase();
    const ok = filtro === "" ? true : filtro === "abertos" ? aberto(p) : filtro === "atrasados" ? atrasado(p) : filtro === "a_receber" ? p.status !== "cancelado" && p.valor_pago < p.valor_total
      : filtro === "prontos" ? p.status_entrega === "pronto" : filtro === "cancelados" ? p.status === "cancelado" : etapaPedido(p)[1] === filtro;
    return ok && (!t || String(p.numero) === t.replace(/\D/g, "") || p.descricao?.toLowerCase().includes(t) || p.clientes?.nome.toLowerCase().includes(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dados, busca, filtro]);
  const abertos = (dados?.peds || []).filter(aberto);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!novo) return; setSalvando(true);
    try {
      let cliente = novo.cliente_id || null;
      if (cliente === "__novo__") {
        if (!novo.cliente_nome.trim()) throw new Error("Informe o nome do cliente novo");
        cliente = (await q<{ id: string }>(sb().from("clientes").insert({ empresa_id: app.empresa.id, nome: novo.cliente_nome.trim(), whatsapp: novo.cliente_whats || null }).select("id").single())).id;
      }
      const r = await q<{ id: string; numero: number }>(sb().from("pedidos").insert({
        empresa_id: app.empresa.id, cliente_id: cliente, tipo_servico: novo.tipo_servico, descricao: novo.descricao, status: "aprovado",
        valor_total: numOuNull(novo.valor_total) ?? 0, valor_pago: numOuNull(novo.valor_pago) ?? 0, custo_estimado: numOuNull(novo.custo_estimado),
        forma_pagamento: novo.forma || null, data_entrega: novo.data_entrega || null, origem: novo.origem || "manual", created_by: app.userId,
        status_producao: novo.producao === "nao" ? "nao_aplica" : "aguardando",
      }).select("id,numero").single());
      toast(`Pedido #${r.numero} criado`); setNovo(null); recarregar(); setDetalhe(r.id);
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };

  return (
    <>
      <PageHeader titulo="Pedidos e Vendas" sub="Pagamento, produção e entrega acompanhados separadamente"
        acoes={pode && <Button onClick={() => setNovo({ cliente_id: "", cliente_nome: "", cliente_whats: "", tipo_servico: "impressao_3d", descricao: "", valor_total: "", valor_pago: "", custo_estimado: "", forma: "", origem: "manual", producao: "sim", data_entrega: hojeISO(app.config.prazo_padrao_dias) })}><Plus className="h-4 w-4" /> Novo pedido</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Em aberto" valor={abertos.length} />
        <Kpi label="Atrasados" valor={abertos.filter(atrasado).length} tom={abertos.some(atrasado) ? "vermelho" : undefined} />
        <Kpi label="Prontos para envio" valor={abertos.filter((p) => p.status_entrega === "pronto").length} />
        <Kpi label="A receber" valor={brl((dados?.peds || []).filter((p) => p.status !== "cancelado").reduce((s, p) => s + Math.max(p.valor_total - p.valor_pago, 0), 0))} />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Buscar por número, descrição ou cliente" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} className="min-w-60 flex-1" aria-label="Buscar" />
          <Select value={filtro} onChange={(e) => { setFiltro(e.target.value); setPagina(1); }} className="w-52" aria-label="Filtro">
            <option value="abertos">Em aberto</option><option value="atrasados">Atrasados</option><option value="pendente">Aguardando pagamento</option>
            <option value="aprovado">Aguardando produção</option><option value="em_producao">Em produção</option><option value="prontos">Prontos para envio</option>
            <option value="a_receber">Com saldo a receber</option><option value="entregue">Entregues</option><option value="cancelados">Cancelados</option><option value="">Todos</option>
          </Select>
        </div>
        {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
        {carregando && !dados ? <Loading /> : lista.length === 0 ? <Empty texto="Nenhum pedido" /> : (
          <>
            <Table head={["Pedido", "Cliente", "Etapa", "Pagamento", "Produção", "Entrega", "Valor"]}>
              {lista.slice((pagina - 1) * 25, pagina * 25).map((p) => { const [et, tom] = etapaPedido(p); return (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setDetalhe(p.id)}>
                  <Td><div className="font-medium">{app.config.prefixo_pedido}-{p.numero} {p.descricao}</div><div className="text-xs text-slate-500">{data(p.created_at)} · {p.origem === "orcamento" ? "de orçamento" : p.links_acesso ? `via ${p.links_acesso.nome}` : TIPOS_SERVICO[p.tipo_servico]}</div></Td>
                  <Td>{p.clientes?.nome || "—"}</Td>
                  <Td><Badge tom={tomStatus(tom)}>{et}</Badge>{atrasado(p) && <div className="mt-1 text-xs font-medium text-red-600">atrasado ({data(p.data_entrega)})</div>}</Td>
                  <Td><Badge tom={tomStatus(p.status_pagamento)}>{STATUS_PAGAMENTO[p.status_pagamento]}</Badge></Td>
                  <Td className="text-xs">{STATUS_PRODUCAO[p.status_producao]}</Td>
                  <Td className="text-xs">{STATUS_ENTREGA[p.status_entrega]}</Td>
                  <Td className="tnum"><div className="font-medium">{brl(p.valor_total)}</div>{p.valor_pago < p.valor_total && p.status !== "cancelado" && <div className="text-xs text-amber-700">falta {brl(p.valor_total - p.valor_pago)}</div>}</Td>
                </tr>); })}
            </Table>
            <Paginacao pagina={pagina} total={lista.length} porPagina={25} onChange={setPagina} />
          </>
        )}
      </Card>

      <Modal aberto={!!novo} titulo="Novo pedido" onClose={() => setNovo(null)} largura="max-w-2xl">
        {novo && <form onSubmit={criar} className="space-y-3">
          <Grid>
            <Field label="Cliente"><Select value={novo.cliente_id} onChange={(e) => setNovo({ ...novo, cliente_id: e.target.value })}><option value="">Sem cliente</option><option value="__novo__">+ Cliente novo</option>
              {dados?.clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            <Field label="Origem da venda"><Select value={novo.origem} onChange={(e) => setNovo({ ...novo, origem: e.target.value })}>
              {["manual", "whatsapp", "instagram", "loja", "marketplace", "indicacao"].map((o) => <option key={o} value={o}>{({ manual: "Balcão / direto", whatsapp: "WhatsApp", instagram: "Instagram", loja: "Loja virtual", marketplace: "Marketplace", indicacao: "Indicação" } as Record<string, string>)[o]}</option>)}</Select></Field>
          </Grid>
          {novo.cliente_id === "__novo__" && <Grid><Field label="Nome do cliente"><Input required value={novo.cliente_nome} onChange={(e) => setNovo({ ...novo, cliente_nome: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input inputMode="tel" value={novo.cliente_whats} onChange={(e) => setNovo({ ...novo, cliente_whats: e.target.value })} /></Field></Grid>}
          <Field label="Descrição"><Textarea required value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} /></Field>
          <Grid cols={3}>
            <Field label="Serviço"><Select value={novo.tipo_servico} onChange={(e) => setNovo({ ...novo, tipo_servico: e.target.value })}>{Object.entries(TIPOS_SERVICO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Precisa produzir?"><Select value={novo.producao} onChange={(e) => setNovo({ ...novo, producao: e.target.value })}><option value="sim">Sim</option><option value="nao">Não (pronta entrega)</option></Select></Field>
            <Field label="Entrega prevista"><Input type="date" value={novo.data_entrega} onChange={(e) => setNovo({ ...novo, data_entrega: e.target.value })} /></Field>
            <Field label="Valor total (R$)"><Input required inputMode="decimal" value={novo.valor_total} onChange={(e) => setNovo({ ...novo, valor_total: e.target.value })} /></Field>
            <Field label="Já recebido (R$)"><Input inputMode="decimal" value={novo.valor_pago} onChange={(e) => setNovo({ ...novo, valor_pago: e.target.value })} /></Field>
            <Field label="Forma de pagamento"><Select value={novo.forma} onChange={(e) => setNovo({ ...novo, forma: e.target.value })}><option value="">—</option>{FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}</Select></Field>
            {app.pode("custos_ver") && <Field label="Custo estimado (R$)"><Input inputMode="decimal" value={novo.custo_estimado} onChange={(e) => setNovo({ ...novo, custo_estimado: e.target.value })} /></Field>}
          </Grid>
          <p className="text-xs text-slate-500">Os itens e as ordens de produção são adicionados no pedido. Para calcular o preço certo, use um <Link href="/orcamentos/editar/" className="underline">orçamento</Link>.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNovo(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Criar pedido</Button></div>
        </form>}
      </Modal>
      {detalhe && <Detalhe id={detalhe} clis={dados?.clis || []} onClose={() => { setDetalhe(null); if (idUrl) history.replaceState(null, "", "/pedidos/"); }} onMudou={recarregar} />}
    </>
  );
}

type Item = { id: string; descricao: string; quantidade: number; valor_unitario: number; produto_id: string | null; material_id: string | null; peso_g: number | null; tempo_h: number | null };
type Pag = { id: string; valor: number; data: string; forma: string | null; observacao: string | null; estornado: boolean; motivo_estorno: string | null; created_at: string };
type Op = { id: string; numero: number; descricao: string; status: string; quantidade: number; custo_real_total: number; impressoras: { nome: string } | null };

function Detalhe({ id, clis, onClose, onMudou }: { id: string; clis: { id: string; nome: string }[]; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const pode = app.pode("pedidos_editar") && app.podeEscrever;
  const podePagar = (app.pode("pedidos_editar") || app.pode("financeiro_ver")) && app.podeEscrever;
  const verCusto = app.pode("custos_ver");
  const [aba, setAba] = useState<"resumo" | "itens" | "pagamentos" | "producao" | "entrega" | "historico">("resumo");
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [pag, setPag] = useState<{ valor: string; data: string; forma: string; conta: string; obs: string } | null>(null);
  const [estorno, setEstorno] = useState<{ p: Pag; motivo: string } | null>(null);
  const [cancelar, setCancelar] = useState<string | null>(null);
  const [novoItem, setNovoItem] = useState({ descricao: "", quantidade: "1", valor: "", produto_id: "" });
  const [ent, setEnt] = useState<{ status: string; transportadora: string; rastreio: string } | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const p = await q<Pedido>(sb().from("pedidos").select(SEL).eq("id", id).single());
    const [itens, pags, ops, contas, prods, hist] = await Promise.all([
      q<Item[]>(sb().from("pedido_itens").select("id,descricao,quantidade,valor_unitario,produto_id,material_id,peso_g,tempo_h").eq("pedido_id", id).order("created_at")),
      q<Pag[]>(sb().from("pagamentos").select("id,valor,data,forma,observacao,estornado,motivo_estorno,created_at").eq("pedido_id", id).order("data")),
      q<Op[]>(sb().from("ordens_producao").select("id,numero,descricao,status,quantidade,custo_real_total,impressoras(nome)").eq("pedido_id", id).order("numero")),
      app.pode("financeiro_ver") || app.pode("pedidos_editar") ? q<{ id: string; nome: string }[]>(sb().from("contas_financeiras").select("id,nome").eq("empresa_id", app.empresa.id).eq("ativa", true).order("nome")) : Promise.resolve([]),
      app.pode("produtos_ver") ? q<{ id: string; nome: string; preco_venda: number }[]>(sb().from("produtos").select("id,nome,preco_venda").eq("empresa_id", app.empresa.id).eq("status", "ativo").order("nome")) : Promise.resolve([]),
      app.pode("usuarios_admin") ? q<{ id: number; email: string | null; acao: string; detalhes: Record<string, unknown>; created_at: string }[]>(sb().from("auditoria").select("id,email,acao,detalhes,created_at").eq("entidade", "pedidos").eq("entidade_id", id).order("id", { ascending: false }).limit(50)) : Promise.resolve([]),
    ]);
    return { p, itens, pags, ops, contas, prods, hist };
  }, [id]);
  useEffect(() => {
    if (!dados) return;
    const p = dados.p;
    setF({ descricao: p.descricao || "", cliente_id: p.cliente_id || "", valor_total: String(p.valor_total).replace(".", ","), custo_estimado: p.custo_estimado != null ? String(p.custo_estimado).replace(".", ",") : "",
      data_entrega: p.data_entrega || "", forma_pagamento: p.forma_pagamento || "", observacoes: p.observacoes || "", status_producao: p.status_producao });
    setEnt({ status: p.status_entrega, transportadora: p.transportadora || "", rastreio: p.codigo_rastreio || "" });
  }, [dados]);
  const mudou = () => { recarregar(); onMudou(); };
  if (falha) return <Modal aberto titulo="Pedido" onClose={onClose}><ErrorBox erro={falha} /></Modal>;
  if (!dados || !f) return <Modal aberto titulo="Pedido" onClose={onClose}><Loading /></Modal>;
  const p = dados.p;
  const cancelado = p.status === "cancelado";
  const [et, tom] = etapaPedido(p);
  const numero = `${app.config.prefixo_pedido}-${p.numero}`;
  const w = linkWhats(p.clientes?.whatsapp || p.clientes?.telefone, preencher(app.config.msg_pedido, { cliente: p.clientes?.nome.split(" ")[0] || "", numero, prazo: data(p.data_entrega) }));
  const somaItens = dados.itens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);
  const custo = p.status_producao === "concluida" && p.custo_real > 0 ? p.custo_real : p.custo_estimado || 0;
  const lucro = p.valor_total - custo - p.impostos_estimados;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await q(sb().from("pedidos").update({ descricao: f.descricao, cliente_id: f.cliente_id || null, valor_total: numOuNull(f.valor_total) ?? 0, custo_estimado: numOuNull(f.custo_estimado),
        data_entrega: f.data_entrega || null, forma_pagamento: f.forma_pagamento || null, observacoes: f.observacoes || null,
        ...(f.status_producao !== p.status_producao && ["nao_aplica", "aguardando"].includes(f.status_producao) ? { status_producao: f.status_producao } : {}) }).eq("id", id));
      toast("Pedido atualizado"); mudou();
    } catch (e2) { erro(e2); }
  };

  return (
    <Modal aberto titulo={`Pedido ${numero}`} onClose={onClose} largura="max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tom={tomStatus(tom)}>{et}</Badge>
        <Badge tom={tomStatus(p.status_pagamento)}>{STATUS_PAGAMENTO[p.status_pagamento]}</Badge>
        <Badge>{STATUS_PRODUCAO[p.status_producao]}</Badge><Badge>{STATUS_ENTREGA[p.status_entrega]}</Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {w && <a href={w} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp</Button></a>}
          <Link href={`/pedidos/comprovante/?id=${id}`} target="_blank"><Button size="sm" variant="secondary"><Printer className="h-4 w-4" /> Comprovante</Button></Link>
          {pode && !cancelado && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelar("")}><Ban className="h-4 w-4" /> Cancelar pedido</Button>}
        </div>
      </div>
      {cancelado && <div className="mb-3"><Aviso tom="amarelo">Pedido cancelado — motivo: {p.motivo_cancelamento || "não informado"}.{p.valor_pago > 0 && ` Há ${brl(p.valor_pago)} recebido: estorne os pagamentos se devolveu o dinheiro.`}</Aviso></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Valor do pedido" valor={brl(p.valor_total)} />
        <Kpi label="Recebido" valor={brl(p.valor_pago)} sub={p.valor_total > p.valor_pago ? `falta ${brl(p.valor_total - p.valor_pago)}` : undefined} />
        {verCusto && <Kpi label={p.status_producao === "concluida" && p.custo_real > 0 ? "Custo real" : "Custo estimado"} valor={brl(custo)} sub={p.status_producao !== "concluida" && p.custo_real > 0 ? `${brl(p.custo_real)} já gastos na produção` : undefined} />}
        {verCusto && <Kpi label="Lucro do pedido" valor={brl(lucro)} tom={lucro >= 0 ? "verde" : "vermelho"} sub={p.impostos_estimados > 0 ? `já descontados ${brl(p.impostos_estimados)} de impostos/taxas` : undefined} />}
      </div>
      <Tabs abas={[["resumo", "Resumo"], ["itens", `Itens (${dados.itens.length})`], ["pagamentos", `Pagamentos (${dados.pags.filter((x) => !x.estornado).length})`], ["producao", `Produção (${dados.ops.length})`], ["entrega", "Entrega"], ...(app.pode("usuarios_admin") ? [["historico", "Histórico"] as ["historico", string]] : [])]} ativa={aba} onChange={setAba} />

      {aba === "resumo" && <form onSubmit={salvar} className="space-y-3">
        <fieldset disabled={!pode || cancelado} className="space-y-3">
          <Grid>
            <Field label="Cliente"><Select value={f.cliente_id} onChange={(e) => setF({ ...f, cliente_id: e.target.value })}><option value="">Sem cliente</option>{clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            <Field label="Forma de pagamento"><Select value={f.forma_pagamento} onChange={(e) => setF({ ...f, forma_pagamento: e.target.value })}><option value="">—</option>{FORMAS_PAGAMENTO.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          </Grid>
          <Field label="Descrição"><Textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
          <Grid cols={4}>
            <Field label="Valor total (R$)" hint={somaItens > 0 && Math.abs(somaItens - (numOuNull(f.valor_total) || 0)) > 0.01 ? `Itens somam ${brl(somaItens)}` : undefined}><Input inputMode="decimal" value={f.valor_total} onChange={(e) => setF({ ...f, valor_total: e.target.value })} /></Field>
            {verCusto && <Field label="Custo estimado (R$)"><Input inputMode="decimal" value={f.custo_estimado} onChange={(e) => setF({ ...f, custo_estimado: e.target.value })} /></Field>}
            <Field label="Entrega prevista"><Input type="date" value={f.data_entrega} onChange={(e) => setF({ ...f, data_entrega: e.target.value })} /></Field>
            {["aguardando", "nao_aplica"].includes(p.status_producao) && <Field label="Produção"><Select value={f.status_producao} onChange={(e) => setF({ ...f, status_producao: e.target.value })}><option value="aguardando">Precisa produzir</option><option value="nao_aplica">Sem produção</option></Select></Field>}
          </Grid>
          <Field label="Observações"><Textarea value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
          {p.orcamento_id && <p className="text-sm">Veio do <Link href={`/orcamentos/editar/?id=${p.orcamento_id}`} className="text-brand-700 underline">orçamento</Link> — os valores aprovados ficam guardados lá.</p>}
        </fieldset>
        {pode && !cancelado && <div className="flex justify-end"><Button type="submit">Salvar</Button></div>}
      </form>}

      {aba === "itens" && <div className="space-y-3">
        {!dados.itens.length ? <Empty texto="Nenhum item" /> : <Table head={["Item", "Qtd", "Unitário", "Total", ""]}>{dados.itens.map((i) => (
          <tr key={i.id}><Td>{i.descricao}{(i.peso_g || i.tempo_h) && <div className="text-xs text-slate-500">{i.peso_g && `${num(i.peso_g)} g`}{i.tempo_h && ` · ${num(i.tempo_h)} h`} por peça</div>}</Td>
            <Td className="tnum">{num(i.quantidade)}</Td><Td className="tnum">{brl(i.valor_unitario)}</Td><Td className="tnum">{brl(i.quantidade * i.valor_unitario)}</Td>
            <Td>{pode && !cancelado && !dados.ops.some((o) => o.descricao === i.descricao && o.status !== "cancelada") && <button aria-label="Remover item" onClick={async () => { try { await q(sb().from("pedido_itens").delete().eq("id", i.id)); mudou(); } catch (e) { erro(e); } }} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</Td></tr>))}</Table>}
        {pode && !cancelado && <form className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_90px_120px_auto]" onSubmit={async (e) => { e.preventDefault(); try {
          const pr = dados.prods.find((x) => x.id === novoItem.produto_id);
          await q(sb().from("pedido_itens").insert({ empresa_id: app.empresa.id, pedido_id: id, descricao: novoItem.descricao || pr?.nome || "Item", quantidade: numOuNull(novoItem.quantidade) || 1, valor_unitario: numOuNull(novoItem.valor) ?? pr?.preco_venda ?? 0, produto_id: novoItem.produto_id || null }));
          setNovoItem({ descricao: "", quantidade: "1", valor: "", produto_id: "" }); mudou(); } catch (e2) { erro(e2); } }}>
          <Select value={novoItem.produto_id} onChange={(e) => { const pr = dados.prods.find((x) => x.id === e.target.value); setNovoItem({ ...novoItem, produto_id: e.target.value, descricao: pr?.nome || novoItem.descricao, valor: pr ? String(pr.preco_venda).replace(".", ",") : novoItem.valor }); }} aria-label="Produto">
            <option value="">Item avulso</option>{dados.prods.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select>
          <Input placeholder="Descrição" value={novoItem.descricao} onChange={(e) => setNovoItem({ ...novoItem, descricao: e.target.value })} aria-label="Descrição" />
          <Input inputMode="decimal" placeholder="Qtd" value={novoItem.quantidade} onChange={(e) => setNovoItem({ ...novoItem, quantidade: e.target.value })} aria-label="Quantidade" />
          <Input inputMode="decimal" placeholder="Unitário" value={novoItem.valor} onChange={(e) => setNovoItem({ ...novoItem, valor: e.target.value })} aria-label="Valor unitário" />
          <Button type="submit"><Plus className="h-4 w-4" /></Button>
        </form>}
        {somaItens > 0 && pode && !cancelado && Math.abs(somaItens - p.valor_total) > 0.01 && <Button size="sm" variant="secondary" onClick={async () => { try { await q(sb().from("pedidos").update({ valor_total: Math.round(somaItens * 100) / 100 }).eq("id", id)); mudou(); } catch (e) { erro(e); } }}>Usar a soma dos itens ({brl(somaItens)}) como valor do pedido</Button>}
      </div>}

      {aba === "pagamentos" && <div className="space-y-3">
        {!dados.pags.length ? <Empty texto="Nenhum pagamento registrado" /> : <Table head={["Data", "Valor", "Forma", "Observação", ""]}>{dados.pags.map((g) => (
          <tr key={g.id} className={g.estornado ? "opacity-50" : ""}><Td>{data(g.data)}</Td><Td className={cn("tnum", g.estornado && "line-through")}>{brl(g.valor)}</Td><Td>{g.forma || "—"}</Td>
            <Td className="text-slate-500">{g.estornado ? `Estornado: ${g.motivo_estorno}` : g.observacao || "—"}</Td>
            <Td>{(app.pode("financeiro_ver") || app.papel === "dono" || app.papel === "admin") && app.podeEscrever && !g.estornado && <button onClick={() => setEstorno({ p: g, motivo: "" })} className="flex items-center gap-1 text-xs text-slate-500 hover:underline"><Undo2 className="h-3 w-3" /> Estornar</button>}</Td></tr>))}</Table>}
        {podePagar && !cancelado && p.valor_pago < p.valor_total && <Button onClick={() => setPag({ valor: String(Math.round((p.valor_total - p.valor_pago) * 100) / 100).replace(".", ","), data: hojeISO(), forma: p.forma_pagamento || "Pix", conta: "", obs: "" })}><Plus className="h-4 w-4" /> Registrar pagamento</Button>}
        {p.valor_pago >= p.valor_total && p.valor_total > 0 && <Aviso tom="verde">Pedido quitado.</Aviso>}
      </div>}

      {aba === "producao" && <div className="space-y-3">
        {!dados.ops.length ? <Empty texto={p.status_producao === "nao_aplica" ? "Este pedido não precisa de produção" : "Nenhuma ordem de produção"} /> : <Table head={["Ordem", "Impressora", "Situação", verCusto ? "Custo real" : ""]}>{dados.ops.map((o) => (
          <tr key={o.id}><Td><Link href={`/producao/?id=${o.id}`} className="text-brand-700 hover:underline">OP-{o.numero}</Link> {o.descricao} ({num(o.quantidade)} un)</Td><Td>{o.impressoras?.nome || "—"}</Td>
            <Td><Badge tom={tomStatus(o.status)}>{STATUS_OP[o.status]}</Badge></Td><Td className="tnum">{verCusto && o.custo_real_total > 0 ? brl(o.custo_real_total) : ""}</Td></tr>))}</Table>}
        {app.pode("producao_gerenciar") && app.podeEscrever && !cancelado && p.status_producao !== "nao_aplica" && dados.itens.length > 0 && (
          <Button variant="secondary" onClick={async () => { try { const n = await rpc<number>("gerar_ordens_pedido", { p_pedido: id }); toast(n ? `${n} ordem(ns) criada(s)` : "Todos os itens já têm ordem"); mudou(); } catch (e) { erro(e); } }}><Factory className="h-4 w-4" /> Gerar ordens dos itens</Button>)}
        {!dados.itens.length && p.status_producao !== "nao_aplica" && <p className="text-sm text-slate-500">Adicione os itens do pedido para gerar as ordens de produção.</p>}
      </div>}

      {aba === "entrega" && ent && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await rpc("atualizar_entrega", { p_pedido: id, p_status: ent.status, p_transportadora: ent.transportadora, p_rastreio: ent.rastreio }); toast("Entrega atualizada"); mudou(); } catch (e2) { erro(e2); } }}>
        <fieldset disabled={cancelado || !((app.pode("pedidos_editar") || app.pode("expedicao_gerenciar")) && app.podeEscrever)} className="space-y-3">
          <Grid cols={3}>
            <Field label="Situação da entrega"><Select value={ent.status} onChange={(e) => setEnt({ ...ent, status: e.target.value })}>{Object.entries(STATUS_ENTREGA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Transportadora / forma"><Input list="transp" value={ent.transportadora} onChange={(e) => setEnt({ ...ent, transportadora: e.target.value })} /></Field>
            <Field label="Código de rastreio"><Input value={ent.rastreio} onChange={(e) => setEnt({ ...ent, rastreio: e.target.value })} /></Field>
          </Grid>
          <datalist id="transp">{["Retirada no local", "Entrega própria", "Correios", "Jadlog", "Loggi", "Motoboy"].map((t) => <option key={t} value={t} />)}</datalist>
          {p.entregue_em && <p className="text-sm text-slate-500">Entregue em {dataHora(p.entregue_em)}.</p>}
          <p className="text-xs text-slate-500">Para separação, conferência, medidas, frete e etiqueta, use <Link href="/expedicao/" className="text-brand-700 underline">Expedição e Entregas</Link>. Depois que o pedido entra lá, a entrega é atualizada por lá.</p>
          <Button type="submit">Salvar entrega</Button>
        </fieldset>
      </form>}

      {aba === "historico" && (!dados.hist.length ? <Empty texto="Sem alterações registradas" /> : <Table head={["Quando", "Quem", "O que mudou"]}>{dados.hist.map((h) => (
        <tr key={h.id}><Td className="whitespace-nowrap">{dataHora(h.created_at)}</Td><Td>{h.email || "sistema"}</Td><Td className="text-slate-500">{h.acao === "update" ? Object.keys(h.detalhes || {}).join(", ") : h.acao === "insert" ? "criou o pedido" : h.acao}</Td></tr>))}</Table>)}

      <Modal aberto={!!pag} titulo="Registrar pagamento" onClose={() => setPag(null)}>
        {pag && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const falta = await rpc<number>("registrar_pagamento", { p_pedido: id, p_valor: numOuNull(pag.valor), p_data: pag.data, p_forma: pag.forma, p_conta: pag.conta || null, p_observacao: pag.obs || null }); toast(falta > 0 ? `Pagamento registrado. Falta ${brl(falta)}` : "Pedido quitado!"); setPag(null); mudou(); } catch (e2) { erro(e2); } }}>
          <p className="text-sm text-slate-500">Saldo em aberto: {brl(p.valor_total - p.valor_pago)}</p>
          <Grid><Field label="Valor (R$)"><Input required autoFocus inputMode="decimal" value={pag.valor} onChange={(e) => setPag({ ...pag, valor: e.target.value })} /></Field>
            <Field label="Data"><Input type="date" value={pag.data} onChange={(e) => setPag({ ...pag, data: e.target.value })} /></Field>
            <Field label="Forma"><Select value={pag.forma} onChange={(e) => setPag({ ...pag, forma: e.target.value })}>{FORMAS_PAGAMENTO.map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Conta"><Select value={pag.conta} onChange={(e) => setPag({ ...pag, conta: e.target.value })}><option value="">—</option>{dados.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field></Grid>
          <Field label="Observação"><Input value={pag.obs} onChange={(e) => setPag({ ...pag, obs: e.target.value })} placeholder="Sinal, 2ª parcela…" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPag(null)}>Cancelar</Button><Button type="submit">Registrar</Button></div>
        </form>}
      </Modal>
      <Confirmar aberto={!!estorno} titulo="Estornar pagamento" perigo confirmar="Estornar" onCancel={() => setEstorno(null)}
        onOk={async () => { try { await rpc("estornar_pagamento", { p_pagamento: estorno!.p.id, p_motivo: estorno!.motivo }); toast("Pagamento estornado"); setEstorno(null); mudou(); } catch (e) { erro(e); } }}
        texto="O pagamento continua no histórico, marcado como estornado, e o saldo do pedido volta a ficar em aberto.">
        {estorno && <div className="mt-3"><Field label="Motivo"><Input required value={estorno.motivo} onChange={(e) => setEstorno({ ...estorno, motivo: e.target.value })} /></Field></div>}
      </Confirmar>
      <Confirmar aberto={cancelar !== null} titulo="Cancelar pedido" perigo confirmar="Cancelar pedido" onCancel={() => setCancelar(null)}
        onOk={async () => { try { await rpc("cancelar_pedido", { p_pedido: id, p_motivo: cancelar }); toast("Pedido cancelado"); setCancelar(null); mudou(); } catch (e) { erro(e); } }}
        texto="As ordens de produção que ainda não terminaram são canceladas e o material reservado volta para o estoque. Pagamentos não são estornados automaticamente.">
        <div className="mt-3"><Field label="Motivo"><Input required value={cancelar || ""} onChange={(e) => setCancelar(e.target.value)} /></Field></div>
      </Confirmar>
    </Modal>
  );
}
