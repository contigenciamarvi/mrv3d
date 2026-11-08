"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, Check, Undo2, Download, Trash2, Pencil } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, hojeISO, numOuNull, CAT_FINANCEIRO, FORMAS_PAGAMENTO, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Tabs, Kpi, Checkbox, Confirmar, Aviso } from "@/components/ui";

type Resumo = {
  faturamento: number; custos_variaveis: number; impostos_taxas: number; margem_contribuicao: number; lucro_bruto: number; despesas_operacionais: number; custos_fixos: number;
  resultado_liquido: number; receita_recebida: number; despesas_pagas: number; fluxo_caixa: number; a_receber: number; a_pagar: number; vencidas_pagar: number;
  mensal: { mes: string; entradas: number; saidas: number }[]; contas: { id: string; nome: string; tipo: string; saldo: number }[];
};
type Lanc = { id: string; tipo: string; categoria: string; descricao: string; valor: number; vencimento: string; pago: boolean; data_pagamento: string | null; conta_id: string | null;
  forma: string | null; centro_custo: string | null; observacao: string | null; parcela: number | null; total_parcelas: number | null; cancelado: boolean };
type Conta = { id: string; nome: string; tipo: string; saldo_inicial: number; ativa: boolean };
type Aba = "geral" | "receber" | "pagar" | "lancamentos" | "contas";
const mesCurto = (m: string) => new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
const csv = (nome: string, linhas: (string | number | null)[][]) => {
  const t = "﻿" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = `${nome}.csv`; a.click();
};

export default function Financeiro() { return <Exige perm="financeiro_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.podeEscrever;
  const abaUrl = useParam("aba");
  const [aba, setAba] = useState<Aba>("geral");
  const [inicio, setInicio] = useState(hojeISO().slice(0, 8) + "01");
  const [fim, setFim] = useState(hojeISO());
  const [novo, setNovo] = useState<Record<string, string> | null>(null);
  const [editar, setEditar] = useState<Lanc | null>(null);
  const [baixa, setBaixa] = useState<{ l: Lanc; data: string; conta: string; forma: string } | null>(null);
  const [excluir, setExcluir] = useState<Lanc | null>(null);
  useEffect(() => { if (abaUrl) setAba(abaUrl as Aba); }, [abaUrl]);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [r, lancs, contas, receber] = await Promise.all([
      rpc<Resumo>("financeiro_resumo", { p_empresa: app.empresa.id, p_inicio: inicio, p_fim: fim }),
      q<Lanc[]>(sb().from("lancamentos").select("*").eq("empresa_id", app.empresa.id).eq("cancelado", false).order("vencimento").limit(5000)),
      q<Conta[]>(sb().from("contas_financeiras").select("*").eq("empresa_id", app.empresa.id).order("nome")),
      q<{ id: string; numero: number; descricao: string | null; valor_total: number; valor_pago: number; data_entrega: string | null; created_at: string; clientes: { nome: string } | null }[]>(
        sb().from("pedidos").select("id,numero,descricao,valor_total,valor_pago,data_entrega,created_at,clientes(nome)").eq("empresa_id", app.empresa.id).neq("status", "cancelado").order("created_at").limit(3000)),
    ]);
    return { r, lancs, contas, receber: receber.filter((p) => p.valor_total > p.valor_pago + 0.004) };
  }, [app.empresa.id, inicio, fim]);
  const hoje = hojeISO();
  const pagar = useMemo(() => (dados?.lancs || []).filter((l) => l.tipo === "despesa" && !l.pago), [dados]);
  const receberManual = useMemo(() => (dados?.lancs || []).filter((l) => l.tipo === "receita" && !l.pago), [dados]);
  const doPeriodo = useMemo(() => (dados?.lancs || []).filter((l) => l.vencimento >= inicio && l.vencimento <= fim), [dados, inicio, fim]);
  const nomeConta = (id: string | null) => dados?.contas.find((c) => c.id === id)?.nome || "—";

  const darBaixa = async (e: React.FormEvent) => {
    e.preventDefault(); if (!baixa) return;
    try { await q(sb().from("lancamentos").update({ pago: true, data_pagamento: baixa.data, conta_id: baixa.conta || null, forma: baixa.forma || null }).eq("id", baixa.l.id)); toast(baixa.l.tipo === "despesa" ? "Conta paga" : "Recebimento registrado"); setBaixa(null); recarregar(); }
    catch (e2) { erro(e2); }
  };
  const desfazer = async (l: Lanc) => { try { await q(sb().from("lancamentos").update({ pago: false, data_pagamento: null }).eq("id", l.id)); toast("Baixa desfeita"); recarregar(); } catch (e) { erro(e); } };
  const r = dados?.r;

  const TabelaLanc = ({ lista, acoes = true }: { lista: Lanc[]; acoes?: boolean }) => !lista.length ? <Empty texto="Nada por aqui" /> : (
    <Table head={["Vencimento", "Descrição", "Categoria", "Valor", "Situação", acoes ? "" : ""]}>
      {lista.map((l) => { const vencida = !l.pago && l.vencimento < hoje; return (
        <tr key={l.id}><Td className={cn(vencida && "font-medium text-red-600")}>{data(l.vencimento)}</Td>
          <Td><div>{l.descricao}</div><div className="text-xs text-slate-500">{[l.centro_custo, l.pago && nomeConta(l.conta_id) !== "—" && nomeConta(l.conta_id), l.forma].filter(Boolean).join(" · ")}</div></Td>
          <Td><Badge>{CAT_FINANCEIRO[l.categoria]}</Badge></Td>
          <Td className={cn("tnum font-medium", l.tipo === "receita" ? "text-emerald-700" : "")}>{l.tipo === "despesa" ? "− " : "+ "}{brl(l.valor)}</Td>
          <Td>{l.pago ? <Badge tom="verde">{l.tipo === "despesa" ? "Pago" : "Recebido"} {data(l.data_pagamento)}</Badge> : vencida ? <Badge tom="vermelho">Vencido</Badge> : <Badge tom="amarelo">Em aberto</Badge>}</Td>
          <Td>{acoes && pode && <div className="flex justify-end gap-1">
            {!l.pago ? <Button size="sm" variant="secondary" onClick={() => setBaixa({ l, data: hoje, conta: l.conta_id || "", forma: l.forma || "Pix" })}><Check className="h-3.5 w-3.5" /> {l.tipo === "despesa" ? "Pagar" : "Receber"}</Button>
              : <button onClick={() => desfazer(l)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Desfazer baixa" aria-label="Desfazer baixa"><Undo2 className="h-4 w-4" /></button>}
            <button onClick={() => setEditar(l)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => setExcluir(l)} className="rounded p-1.5 text-slate-400 hover:text-red-600" aria-label="Excluir"><Trash2 className="h-4 w-4" /></button>
          </div>}</Td></tr>); })}
    </Table>
  );

  return (
    <>
      <PageHeader titulo="Financeiro" sub="Contas a pagar e a receber, fluxo de caixa e resultado — lucro e caixa separados"
        acoes={<>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" aria-label="Início" />
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" aria-label="Fim" />
          {pode && <Button onClick={() => setNovo({ tipo: "despesa", categoria: "outros", descricao: "", valor: "", vencimento: hoje, parcelas: "1", recorrente: "", pago: "", conta: "", forma: "", centro_custo: "", observacao: "" })}><Plus className="h-4 w-4" /> Novo lançamento</Button>}
        </>} />
      <Tabs abas={[["geral", "Visão geral"], ["receber", "Contas a receber"], ["pagar", `Contas a pagar${pagar.length ? ` (${pagar.length})` : ""}`], ["lancamentos", "Lançamentos"], ["contas", "Contas bancárias"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && r && (
        <>
          {aba === "geral" && <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">Resultado (pelas vendas do período)</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Faturamento" valor={brl(r.faturamento)} />
                <Kpi label="Custos variáveis" valor={brl(r.custos_variaveis)} sub="Custo real das ordens (ou estimado)" />
                <Kpi label="Margem de contribuição" valor={brl(r.margem_contribuicao)} sub={`Após ${brl(r.impostos_taxas)} de impostos e taxas`} />
                <Kpi label="Resultado líquido estimado" valor={brl(r.resultado_liquido)} tom={r.resultado_liquido >= 0 ? "verde" : "vermelho"}
                  sub={r.despesas_operacionais > 0 ? `Descontadas ${brl(r.despesas_operacionais)} de despesas lançadas` : `Descontados ${brl(r.custos_fixos)} de custos fixos da configuração`} />
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-500">Caixa (o que entrou e saiu de fato)</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Recebido" valor={brl(r.receita_recebida)} />
                <Kpi label="Despesas pagas" valor={brl(r.despesas_pagas)} sub="Inclui compras" />
                <Kpi label="Fluxo de caixa" valor={brl(r.fluxo_caixa)} tom={r.fluxo_caixa >= 0 ? "verde" : "vermelho"} />
                <Kpi label="A receber / a pagar" valor={<span className="text-base">{brl(r.a_receber)} / {brl(r.a_pagar)}</span>} tom={r.vencidas_pagar > 0 ? "vermelho" : undefined} sub={r.vencidas_pagar > 0 ? `${brl(r.vencidas_pagar)} vencido` : "Tudo em dia"} />
              </div>
            </div>
            <Card><CardTitle>Entradas e saídas por mês</CardTitle>
              <div className="h-72"><ResponsiveContainer><BarChart data={r.mensal}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tickFormatter={mesCurto} fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} width={64} />
                <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesCurto(String(l))} /><Legend />
                <Bar dataKey="entradas" name="Entradas" fill="#16a34a" radius={[3, 3, 0, 0]} /><Bar dataKey="saidas" name="Saídas" fill="#dc2626" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Card>
            {r.contas.length > 0 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{r.contas.map((c) => <Kpi key={c.id} label={c.nome} valor={brl(c.saldo)} sub="Saldo pelo sistema" />)}</div>}
            <Aviso>Compras de material entram como custo do pedido quando consumidas na produção, por isso não são descontadas de novo no resultado. Uma venda parcelada conta uma vez no faturamento e várias vezes no caixa, conforme cada recebimento.</Aviso>
          </div>}

          {aba === "receber" && <div className="space-y-6">
            <Card><CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("a-receber", [["Pedido", "Cliente", "Valor", "Recebido", "Saldo", "Entrega"], ...dados.receber.map((p) => [p.numero, p.clientes?.nome || "", p.valor_total, p.valor_pago, p.valor_total - p.valor_pago, p.data_entrega])])}><Download className="h-4 w-4" /> CSV</Button>}>Pedidos com saldo em aberto</CardTitle>
              {!dados.receber.length ? <Empty texto="Nenhum pedido com saldo a receber" /> : <Table head={["Pedido", "Cliente", "Valor", "Recebido", "Saldo", ""]}>{dados.receber.map((p) => (
                <tr key={p.id}><Td>#{p.numero} {p.descricao}</Td><Td>{p.clientes?.nome || "—"}</Td><Td className="tnum">{brl(p.valor_total)}</Td><Td className="tnum">{brl(p.valor_pago)}</Td>
                  <Td className="tnum font-medium text-amber-700">{brl(p.valor_total - p.valor_pago)}</Td><Td><Link href={`/pedidos/?id=${p.id}`} className="text-sm text-brand-600 underline">Registrar pagamento</Link></Td></tr>))}</Table>}
            </Card>
            <Card><CardTitle>Outras receitas a receber</CardTitle><TabelaLanc lista={receberManual} /></Card>
          </div>}

          {aba === "pagar" && <Card>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("a-pagar", [["Vencimento", "Descrição", "Categoria", "Valor"], ...pagar.map((l) => [l.vencimento, l.descricao, CAT_FINANCEIRO[l.categoria], l.valor])])}><Download className="h-4 w-4" /> CSV</Button>}>
              Contas a pagar — {brl(pagar.reduce((s, l) => s + l.valor, 0))}</CardTitle>
            <TabelaLanc lista={pagar} />
          </Card>}

          {aba === "lancamentos" && <Card>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("lancamentos", [["Tipo", "Vencimento", "Descrição", "Categoria", "Centro de custo", "Valor", "Pago em", "Conta"], ...doPeriodo.map((l) => [l.tipo, l.vencimento, l.descricao, CAT_FINANCEIRO[l.categoria], l.centro_custo, l.valor, l.data_pagamento, nomeConta(l.conta_id)])])}><Download className="h-4 w-4" /> CSV</Button>}>
              Lançamentos com vencimento no período</CardTitle>
            <TabelaLanc lista={doPeriodo} />
            <p className="mt-3 text-xs text-slate-500">Pagamentos de pedidos ficam em cada pedido. Compras registradas em Compras ficam em Relatórios → Gastos.</p>
          </Card>}

          {aba === "contas" && <Contas contas={dados.contas} saldos={r.contas} pode={pode} onMudou={recarregar} />}
        </>
      )}

      <Modal aberto={!!novo} titulo="Novo lançamento" onClose={() => setNovo(null)} largura="max-w-2xl">
        {novo && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try {
          const n = await rpc<number>("criar_lancamentos", { p_empresa: app.empresa.id, p_tipo: novo.tipo, p_categoria: novo.categoria, p_descricao: novo.descricao, p_valor_total: numOuNull(novo.valor),
            p_primeiro_vencimento: novo.vencimento, p_parcelas: Number(novo.parcelas) || 1, p_recorrente_meses: Number(novo.recorrente) || null, p_pago: !!novo.pago, p_conta: novo.conta || null,
            p_forma: novo.forma || null, p_centro_custo: novo.centro_custo || null, p_observacao: novo.observacao || null });
          toast(n > 1 ? `${n} lançamentos criados` : "Lançamento criado"); setNovo(null); recarregar(); } catch (e2) { erro(e2); } }}>
          <div className="grid grid-cols-2 gap-2">{[["despesa", "Despesa (pagar)"], ["receita", "Receita (receber)"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setNovo({ ...novo, tipo: k, categoria: k === "receita" ? "vendas" : "outros" })} className={cn("h-10 rounded-lg border text-sm font-medium", novo.tipo === k ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700")}>{l}</button>))}</div>
          <Grid>
            <Field label="Descrição"><Input required value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} placeholder={novo.tipo === "despesa" ? "Conta de luz, aluguel…" : "Serviço avulso…"} /></Field>
            <Field label="Categoria"><Select value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>{Object.entries(CAT_FINANCEIRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={Number(novo.parcelas) > 1 ? "Valor total (R$)" : "Valor (R$)"}><Input required inputMode="decimal" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></Field>
            <Field label={Number(novo.parcelas) > 1 || Number(novo.recorrente) > 1 ? "Primeiro vencimento" : "Vencimento"}><Input type="date" required value={novo.vencimento} onChange={(e) => setNovo({ ...novo, vencimento: e.target.value })} /></Field>
            <Field label="Parcelar em" hint="Divide o valor total"><Select value={novo.parcelas} disabled={Number(novo.recorrente) > 1} onChange={(e) => setNovo({ ...novo, parcelas: e.target.value })}>{[1, 2, 3, 4, 5, 6, 10, 12, 18, 24].map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x`}</option>)}</Select></Field>
            <Field label="Repetir todo mês" hint="Mesmo valor (aluguel, internet…)"><Select value={novo.recorrente} disabled={Number(novo.parcelas) > 1} onChange={(e) => setNovo({ ...novo, recorrente: e.target.value })}><option value="">Não</option>{[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} meses</option>)}</Select></Field>
            <Field label="Conta"><Select value={novo.conta} onChange={(e) => setNovo({ ...novo, conta: e.target.value })}><option value="">—</option>{dados?.contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            <Field label="Centro de custo (opcional)"><Input value={novo.centro_custo} onChange={(e) => setNovo({ ...novo, centro_custo: e.target.value })} placeholder="Produção, comercial…" /></Field>
          </Grid>
          <Checkbox label={novo.tipo === "despesa" ? "Já está pago" : "Já recebi"} hint={Number(novo.parcelas) > 1 || Number(novo.recorrente) > 1 ? "Só a primeira parcela" : undefined} checked={!!novo.pago} onChange={(v) => setNovo({ ...novo, pago: v ? "1" : "" })} />
          <Field label="Observação"><Textarea value={novo.observacao} onChange={(e) => setNovo({ ...novo, observacao: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNovo(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>
      <Modal aberto={!!editar} titulo="Editar lançamento" onClose={() => setEditar(null)}>
        {editar && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await q(sb().from("lancamentos").update({ descricao: editar.descricao, categoria: editar.categoria, valor: editar.valor, vencimento: editar.vencimento, centro_custo: editar.centro_custo || null, observacao: editar.observacao || null }).eq("id", editar.id)); toast("Lançamento atualizado"); setEditar(null); recarregar(); } catch (e2) { erro(e2); } }}>
          <Field label="Descrição"><Input required value={editar.descricao} onChange={(e) => setEditar({ ...editar, descricao: e.target.value })} /></Field>
          <Grid><Field label="Categoria"><Select value={editar.categoria} onChange={(e) => setEditar({ ...editar, categoria: e.target.value })}>{Object.entries(CAT_FINANCEIRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Valor (R$)"><Input inputMode="decimal" value={String(editar.valor).replace(".", ",")} onChange={(e) => setEditar({ ...editar, valor: numOuNull(e.target.value) || 0 })} /></Field>
            <Field label="Vencimento"><Input type="date" value={editar.vencimento} onChange={(e) => setEditar({ ...editar, vencimento: e.target.value })} /></Field>
            <Field label="Centro de custo"><Input value={editar.centro_custo || ""} onChange={(e) => setEditar({ ...editar, centro_custo: e.target.value })} /></Field></Grid>
          <Field label="Observação"><Textarea value={editar.observacao || ""} onChange={(e) => setEditar({ ...editar, observacao: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditar(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>
      <Modal aberto={!!baixa} titulo={baixa?.l.tipo === "despesa" ? "Pagar conta" : "Registrar recebimento"} onClose={() => setBaixa(null)}>
        {baixa && <form className="space-y-3" onSubmit={darBaixa}>
          <p className="text-sm">{baixa.l.descricao} — <b>{brl(baixa.l.valor)}</b></p>
          <Grid><Field label="Data"><Input type="date" required value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} /></Field>
            <Field label="Conta"><Select value={baixa.conta} onChange={(e) => setBaixa({ ...baixa, conta: e.target.value })}><option value="">—</option>{dados?.contas.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
            <Field label="Forma"><Select value={baixa.forma} onChange={(e) => setBaixa({ ...baixa, forma: e.target.value })}>{FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}</Select></Field></Grid>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setBaixa(null)}>Cancelar</Button><Button type="submit">Confirmar</Button></div>
        </form>}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir lançamento" perigo confirmar="Excluir" onCancel={() => setExcluir(null)}
        onOk={async () => { try { await q(sb().from("lancamentos").update({ cancelado: true }).eq("id", excluir!.id)); toast("Lançamento excluído"); setExcluir(null); recarregar(); } catch (e) { erro(e); } }}
        texto={<>Excluir <b>{excluir?.descricao}</b>? Ele sai das contas e dos relatórios, mas continua no registro de alterações.</>} />
    </>
  );
}

function Contas({ contas, saldos, pode, onMudou }: { contas: Conta[]; saldos: { id: string; saldo: number }[]; pode: boolean; onMudou: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ nome: "", tipo: "banco", saldo: "" });
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {pode && <Card><CardTitle>Nova conta</CardTitle>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await q(sb().from("contas_financeiras").insert({ empresa_id: app.empresa.id, nome: f.nome, tipo: f.tipo, saldo_inicial: numOuNull(f.saldo) || 0 })); toast("Conta criada"); setF({ nome: "", tipo: "banco", saldo: "" }); onMudou(); } catch (e2) { erro(e2); } }}>
          <Field label="Nome"><Input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nubank, Caixa da loja…" /></Field>
          <Field label="Tipo"><Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="banco">Conta bancária</option><option value="caixa">Caixa (dinheiro)</option><option value="carteira_digital">Carteira digital</option></Select></Field>
          <Field label="Saldo inicial (R$)" hint="Saldo no dia em que começou a usar o sistema"><Input inputMode="decimal" value={f.saldo} onChange={(e) => setF({ ...f, saldo: e.target.value })} /></Field>
          <Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Criar conta</Button>
        </form></Card>}
      <Card>{!contas.length ? <Empty texto="Nenhuma conta cadastrada" /> : <Table head={["Conta", "Tipo", "Saldo inicial", "Saldo atual", ""]}>{contas.map((c) => (
        <tr key={c.id} className={c.ativa ? "" : "opacity-50"}><Td className="font-medium">{c.nome}</Td><Td>{({ banco: "Banco", caixa: "Caixa", carteira_digital: "Carteira digital" } as Record<string, string>)[c.tipo]}</Td>
          <Td className="tnum">{brl(c.saldo_inicial)}</Td><Td className="tnum font-medium">{c.ativa ? brl(saldos.find((s) => s.id === c.id)?.saldo) : "—"}</Td>
          <Td>{pode && <Button size="sm" variant="ghost" onClick={async () => { try { await q(sb().from("contas_financeiras").update({ ativa: !c.ativa }).eq("id", c.id)); onMudou(); } catch (e) { erro(e); } }}>{c.ativa ? "Desativar" : "Ativar"}</Button>}</Td></tr>))}</Table>}
        <p className="mt-3 text-xs text-slate-500">O saldo soma pagamentos de pedidos e lançamentos pagos ligados à conta. Compras registradas sem conta não entram aqui. Transferências entre contas e conciliação bancária chegam numa próxima etapa.</p>
      </Card>
    </div>
  );
}
