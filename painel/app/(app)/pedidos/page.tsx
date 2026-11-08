"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, MessageCircle, Trash2, Pencil } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, hojeISO, numOuNull, linkWhats, preencher, STATUS_PEDIDO, TIPOS_SERVICO, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Kpi, Confirmar, Paginacao, Aviso } from "@/components/ui";

type Pedido = { id: string; numero: number; descricao: string | null; status: string; tipo_servico: string; valor_total: number; valor_pago: number; custo_estimado: number | null;
  data_entrega: string | null; origem: string; created_at: string; cliente_id: string | null; clientes: { nome: string; whatsapp: string | null; telefone: string | null } | null; links_acesso: { nome: string } | null };
type ItemPed = { id: string; descricao: string; quantidade: number; valor_unitario: number };

export default function Pedidos() { return <Exige perm="pedidos_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.pode("pedidos_editar") && app.podeEscrever;
  const idUrl = useParam("id");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("abertos");
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState<Record<string, string> | null>(null);
  const [detalhe, setDetalhe] = useState<Pedido | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [peds, clis] = await Promise.all([
      q<Pedido[]>(sb().from("pedidos").select("id,numero,descricao,status,tipo_servico,valor_total,valor_pago,custo_estimado,data_entrega,origem,created_at,cliente_id,clientes(nome,whatsapp,telefone),links_acesso(nome)")
        .eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(3000)),
      app.pode("clientes_ver") ? q<{ id: string; nome: string }[]>(sb().from("clientes").select("id,nome").eq("empresa_id", app.empresa.id).eq("arquivado", false).order("nome")) : Promise.resolve([]),
    ]);
    return { peds, clis };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl && dados) { const p = dados.peds.find((x) => x.id === idUrl); if (p) setDetalhe(p); } }, [idUrl, dados]);

  const hoje = hojeISO();
  const atrasado = (p: Pedido) => !!p.data_entrega && p.data_entrega < hoje && !["entregue", "cancelado"].includes(p.status);
  const lista = useMemo(() => (dados?.peds || []).filter((p) => {
    const t = busca.trim().toLowerCase();
    const okStatus = status === "" || (status === "abertos" ? !["entregue", "cancelado"].includes(p.status) : status === "atrasados" ? atrasado(p) : p.status === status);
    return okStatus && (!t || String(p.numero) === t || p.descricao?.toLowerCase().includes(t) || p.clientes?.nome.toLowerCase().includes(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dados, busca, status]);
  const abertos = (dados?.peds || []).filter((p) => !["entregue", "cancelado"].includes(p.status));

  const criar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!novo) return; setSalvando(true);
    try {
      let cliente = novo.cliente_id || null;
      if (cliente === "__novo__") {
        if (!novo.cliente_nome.trim()) throw new Error("Informe o nome do cliente novo");
        cliente = (await q<{ id: string }>(sb().from("clientes").insert({ empresa_id: app.empresa.id, nome: novo.cliente_nome.trim(), whatsapp: novo.cliente_whats || null }).select("id").single())).id;
      }
      const r = await q<{ numero: number }>(sb().from("pedidos").insert({
        empresa_id: app.empresa.id, cliente_id: cliente, tipo_servico: novo.tipo_servico, descricao: novo.descricao, status: "aprovado",
        valor_total: numOuNull(novo.valor_total) ?? 0, valor_pago: numOuNull(novo.valor_pago) ?? 0, custo_estimado: numOuNull(novo.custo_estimado),
        data_entrega: novo.data_entrega || null, origem: "manual", created_by: app.userId,
      }).select("numero").single());
      toast(`Pedido #${r.numero} criado`); setNovo(null); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const atualizar = async (p: Pedido, patch: Record<string, unknown>, msg: string) => {
    try { await q(sb().from("pedidos").update(patch).eq("id", p.id)); toast(msg); recarregar(); } catch (e) { erro(e); }
  };

  return (
    <>
      <PageHeader titulo="Pedidos e Vendas" sub="Pedidos manuais, vindos de orçamentos aprovados ou dos links de acesso"
        acoes={pode && <Button onClick={() => setNovo({ cliente_id: "", cliente_nome: "", cliente_whats: "", tipo_servico: "impressao_3d", descricao: "", valor_total: "", valor_pago: "", custo_estimado: "", data_entrega: hojeISO(app.config.prazo_padrao_dias) })}><Plus className="h-4 w-4" /> Novo pedido</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Em aberto" valor={abertos.length} />
        <Kpi label="Atrasados" valor={abertos.filter(atrasado).length} tom={abertos.some(atrasado) ? "vermelho" : undefined} />
        <Kpi label="Valor em aberto" valor={brl(abertos.reduce((s, p) => s + p.valor_total, 0))} />
        <Kpi label="A receber" valor={brl((dados?.peds || []).filter((p) => p.status !== "cancelado").reduce((s, p) => s + Math.max(p.valor_total - p.valor_pago, 0), 0))} />
      </div>
      <Aviso>Status financeiro, de produção e de entrega separados, pagamentos parciais com histórico e ordens de produção chegam na <b>Fase 3</b>. Por enquanto o pedido tem uma situação única e o valor pago acumulado.</Aviso>
      <Card className="mt-4">
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Buscar por número, descrição ou cliente" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} className="min-w-60 flex-1" aria-label="Buscar" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="w-44" aria-label="Situação">
            <option value="abertos">Em aberto</option><option value="atrasados">Atrasados</option><option value="">Todos</option>
            {Object.entries(STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </div>
        {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
        {carregando && !dados ? <Loading /> : lista.length === 0 ? <Empty texto="Nenhum pedido" /> : (
          <>
            <Table head={["Pedido", "Cliente", "Entrega", "Situação", "Valor", "Pago", ""]}>
              {lista.slice((pagina - 1) * 25, pagina * 25).map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setDetalhe(p)}>
                  <Td><div className="font-medium">#{p.numero} {p.descricao}</div><div className="text-xs text-slate-500">{TIPOS_SERVICO[p.tipo_servico]} · {data(p.created_at)}
                    {p.origem === "orcamento" && " · de orçamento"}{p.links_acesso && ` · via ${p.links_acesso.nome}`}</div></Td>
                  <Td>{p.clientes?.nome || "—"}</Td>
                  <Td className={cn(atrasado(p) && "font-medium text-red-600")}>{data(p.data_entrega)}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>{pode ? (
                    <Select aria-label="Situação" value={p.status} onChange={(e) => atualizar(p, { status: e.target.value }, "Situação atualizada")} className="h-8 w-36 text-xs">
                      {Object.entries(STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>) : <Badge tom={tomStatus(p.status)}>{STATUS_PEDIDO[p.status]}</Badge>}</Td>
                  <Td className="tnum font-medium">{brl(p.valor_total)}</Td>
                  <Td className={cn("tnum", p.valor_pago >= p.valor_total ? "text-emerald-700" : "text-amber-700")}>{brl(p.valor_pago)}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>{pode && p.valor_pago < p.valor_total && p.status !== "cancelado" &&
                    <Button size="sm" variant="secondary" onClick={() => atualizar(p, { valor_pago: p.valor_total }, "Pagamento registrado")}>Marcar pago</Button>}</Td>
                </tr>
              ))}
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
            <Field label="Serviço"><Select value={novo.tipo_servico} onChange={(e) => setNovo({ ...novo, tipo_servico: e.target.value })}>{Object.entries(TIPOS_SERVICO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </Grid>
          {novo.cliente_id === "__novo__" && <Grid><Field label="Nome do cliente"><Input required value={novo.cliente_nome} onChange={(e) => setNovo({ ...novo, cliente_nome: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input inputMode="tel" value={novo.cliente_whats} onChange={(e) => setNovo({ ...novo, cliente_whats: e.target.value })} /></Field></Grid>}
          <Field label="Descrição"><Textarea required value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} /></Field>
          <Grid cols={4}>
            <Field label="Valor total (R$)"><Input required inputMode="decimal" value={novo.valor_total} onChange={(e) => setNovo({ ...novo, valor_total: e.target.value })} /></Field>
            <Field label="Já pago (R$)"><Input inputMode="decimal" value={novo.valor_pago} onChange={(e) => setNovo({ ...novo, valor_pago: e.target.value })} /></Field>
            {app.pode("custos_ver") && <Field label="Custo estimado (R$)"><Input inputMode="decimal" value={novo.custo_estimado} onChange={(e) => setNovo({ ...novo, custo_estimado: e.target.value })} /></Field>}
            <Field label="Entrega"><Input type="date" value={novo.data_entrega} onChange={(e) => setNovo({ ...novo, data_entrega: e.target.value })} /></Field>
          </Grid>
          <p className="text-xs text-slate-500">Dica: para calcular o preço certo, crie um <Link href="/orcamentos/editar/" className="underline">orçamento</Link> e converta em pedido quando aprovado.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNovo(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Criar pedido</Button></div>
        </form>}
      </Modal>
      {detalhe && <Detalhe p={detalhe} pode={pode} onClose={() => setDetalhe(null)} onMudou={() => { recarregar(); setDetalhe(null); }} />}
    </>
  );
}

function Detalhe({ p, pode, onClose, onMudou }: { p: Pedido; pode: boolean; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ descricao: p.descricao || "", valor_total: String(p.valor_total).replace(".", ","), valor_pago: String(p.valor_pago).replace(".", ","),
    custo_estimado: p.custo_estimado != null ? String(p.custo_estimado).replace(".", ",") : "", data_entrega: p.data_entrega || "", status: p.status });
  const [excluir, setExcluir] = useState(false);
  const { dados: itens } = useDados(() => q<ItemPed[]>(sb().from("pedido_itens").select("id,descricao,quantidade,valor_unitario").eq("pedido_id", p.id).order("created_at")), [p.id]);
  const msg = preencher(app.config.msg_pedido, { cliente: p.clientes?.nome.split(" ")[0] || "", numero: `${app.config.prefixo_pedido}-${p.numero}`, prazo: data(p.data_entrega) });
  const w = linkWhats(p.clientes?.whatsapp || p.clientes?.telefone, msg);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await q(sb().from("pedidos").update({ descricao: f.descricao, valor_total: numOuNull(f.valor_total) ?? 0, valor_pago: numOuNull(f.valor_pago) ?? 0,
        custo_estimado: numOuNull(f.custo_estimado), data_entrega: f.data_entrega || null, status: f.status }).eq("id", p.id));
      toast("Pedido atualizado"); onMudou();
    } catch (e2) { erro(e2); }
  };
  return (
    <Modal aberto titulo={`Pedido #${p.numero}`} onClose={onClose} largura="max-w-2xl">
      <div className="mb-4 flex flex-wrap gap-2">
        {w && <a href={w} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4 text-emerald-600" /> Avisar cliente</Button></a>}
        <Badge tom={tomStatus(p.status)}>{STATUS_PEDIDO[p.status]}</Badge>
        {p.clientes && <span className="text-sm text-slate-500">Cliente: <Link href={`/clientes/?id=${p.cliente_id}`} className="underline">{p.clientes.nome}</Link></span>}
      </div>
      {!!itens?.length && <div className="mb-4"><Table head={["Item", "Qtd", "Unitário", "Total"]}>{itens.map((i) => (
        <tr key={i.id}><Td>{i.descricao}</Td><Td className="tnum">{num(i.quantidade)}</Td><Td className="tnum">{brl(i.valor_unitario)}</Td><Td className="tnum">{brl(i.quantidade * i.valor_unitario)}</Td></tr>))}</Table></div>}
      <form onSubmit={salvar} className="space-y-3">
        <fieldset disabled={!pode} className="space-y-3">
          <Field label="Descrição"><Textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
          <Grid cols={4}>
            <Field label="Valor total"><Input inputMode="decimal" value={f.valor_total} onChange={(e) => setF({ ...f, valor_total: e.target.value })} /></Field>
            <Field label="Pago"><Input inputMode="decimal" value={f.valor_pago} onChange={(e) => setF({ ...f, valor_pago: e.target.value })} /></Field>
            {app.pode("custos_ver") && <Field label="Custo estimado"><Input inputMode="decimal" value={f.custo_estimado} onChange={(e) => setF({ ...f, custo_estimado: e.target.value })} /></Field>}
            <Field label="Entrega"><Input type="date" value={f.data_entrega} onChange={(e) => setF({ ...f, data_entrega: e.target.value })} /></Field>
          </Grid>
          <Field label="Situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </fieldset>
        {pode && <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" className="text-red-600" onClick={() => setExcluir(true)}><Trash2 className="h-4 w-4" /> Excluir</Button>
          <Button type="submit"><Pencil className="h-4 w-4" /> Salvar alterações</Button>
        </div>}
      </form>
      <Confirmar aberto={excluir} titulo="Excluir pedido" perigo confirmar="Excluir" onCancel={() => setExcluir(false)}
        onOk={async () => { try { await q(sb().from("pedidos").delete().eq("id", p.id)); toast("Pedido excluído"); onMudou(); } catch (e) { erro(e); } }}
        texto="Prefira mudar a situação para Cancelado — assim o histórico fica guardado. Excluir apaga o pedido e seus itens." />
    </Modal>
  );
}
