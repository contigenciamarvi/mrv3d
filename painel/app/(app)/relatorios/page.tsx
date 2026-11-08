"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Download } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { brl, num, hojeISO, CAT_GASTO, STATUS_ORCAMENTO } from "@/lib/utils";
import { Button, Card, CardTitle, Input, Table, Td, Loading, ErrorBox, Empty, Tabs, Kpi } from "@/components/ui";

const CORES = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04", "#64748b"];
type Aba = "gastos" | "vendas" | "clientes" | "materia" | "orcamentos";

function csv(nome: string, linhas: (string | number)[][]) {
  const t = "﻿" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = `${nome}.csv`; a.click();
}

export default function Relatorios() { return <Exige perm={["relatorios_ver", "financeiro_ver", "compras_gerenciar"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const [inicio, setInicio] = useState(hojeISO(-29));
  const [fim, setFim] = useState(hojeISO());
  const [aba, setAba] = useState<Aba>("gastos");
  const fimMais = new Date(new Date(fim + "T12:00:00").getTime() + 86400000).toISOString().slice(0, 10);
  const { dados, carregando, erro, recarregar } = useDados(async () => {
    const [gastos, pedidos, movs, orcs] = await Promise.all([
      q<{ categoria: string; valor: number; data: string; descricao: string; materiais: { tipo_compra: string } | null }[]>(sb().from("gastos").select("categoria,valor,data,descricao,materiais(tipo_compra)").eq("empresa_id", app.empresa.id).gte("data", inicio).lte("data", fim)),
      app.pode("pedidos_ver") ? q<{ valor_total: number; valor_pago: number; custo_estimado: number | null; custo_real: number; status: string; created_at: string; clientes: { nome: string } | null }[]>(
        sb().from("pedidos").select("valor_total,valor_pago,custo_estimado,custo_real,status,status_producao,created_at,clientes(nome)").eq("empresa_id", app.empresa.id).neq("status", "cancelado").gte("created_at", inicio).lt("created_at", fimMais)) : Promise.resolve([]),
      app.pode("materia_ver") ? q<{ quantidade: number; tipo: string; estorno_de: string | null; materiais: { nome: string; unidade: string; custo_medio: number } | null }[]>(
        sb().from("movimentacoes_estoque").select("quantidade,tipo,estorno_de,materiais(nome,unidade,custo_medio)").eq("empresa_id", app.empresa.id).eq("tipo", "saida").gte("created_at", inicio).lt("created_at", fimMais)) : Promise.resolve([]),
      app.pode("orcamentos_ver") || app.pode("orcamentos_criar") ? q<{ status: string; total: number; enviado_em: string | null }[]>(
        sb().from("orcamentos").select("status,total,enviado_em").eq("empresa_id", app.empresa.id).gte("created_at", inicio).lt("created_at", fimMais)) : Promise.resolve([]),
    ]);
    return { gastos, pedidos, movs, orcs };
  }, [app.empresa.id, inicio, fim]);

  const r = useMemo(() => {
    if (!dados) return null;
    const porCat: Record<string, number> = {};
    dados.gastos.forEach((g) => { porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.valor); });
    const porMes: Record<string, { fat: number; custo: number; rec: number }> = {};
    dados.pedidos.forEach((p) => { const m = p.created_at.slice(0, 7); porMes[m] ||= { fat: 0, custo: 0, rec: 0 }; porMes[m].fat += p.valor_total; porMes[m].custo += (p as { status_producao?: string }).status_producao === "concluida" && p.custo_real > 0 ? p.custo_real : p.custo_estimado || 0; porMes[m].rec += p.valor_pago; });
    const porCli: Record<string, { n: number; total: number; custo: number }> = {};
    dados.pedidos.forEach((p) => { const c = p.clientes?.nome || "Sem cliente"; porCli[c] ||= { n: 0, total: 0, custo: 0 }; porCli[c].n++; porCli[c].total += p.valor_total; porCli[c].custo += (p as { status_producao?: string }).status_producao === "concluida" && p.custo_real > 0 ? p.custo_real : p.custo_estimado || 0; });
    const porMat: Record<string, { q: number; un: string; valor: number }> = {};
    dados.movs.forEach((m) => { if (!m.materiais) return; const k = m.materiais.nome; porMat[k] ||= { q: 0, un: m.materiais.unidade, valor: 0 }; porMat[k].q += Number(m.quantidade); porMat[k].valor += Number(m.quantidade) * m.materiais.custo_medio; });
    const porSt: Record<string, { n: number; total: number }> = {};
    dados.orcs.forEach((o) => { porSt[o.status] ||= { n: 0, total: 0 }; porSt[o.status].n++; porSt[o.status].total += o.total; });
    return {
      cat: Object.entries(porCat).map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor),
      mes: Object.entries(porMes).sort(), cli: Object.entries(porCli).sort((a, b) => b[1].total - a[1].total),
      mat: Object.entries(porMat).sort((a, b) => b[1].valor - a[1].valor), st: porSt,
    };
  }, [dados]);
  const totalGastos = r?.cat.reduce((s, c) => s + c.valor, 0) || 0;
  const enviados = dados?.orcs.filter((o) => o.enviado_em).length || 0;
  const aprovados = (r?.st.aprovado?.n || 0) + (r?.st.convertido?.n || 0);

  return (
    <>
      <PageHeader titulo="Relatórios" sub="Todos com filtro de período e exportação CSV"
        acoes={<><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" aria-label="Início" /><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" aria-label="Fim" /></>} />
      <Tabs abas={[["gastos", "Gastos por categoria"], ["vendas", "Faturamento"], ["clientes", "Rentabilidade por cliente"], ["materia", "Consumo de matéria-prima"], ["orcamentos", "Conversão de orçamentos"]]} ativa={aba} onChange={setAba} />
      {erro && <ErrorBox erro={erro} onRetry={recarregar} />}
      {carregando && !r ? <Loading /> : r && (
        <Card>
          {aba === "gastos" && (r.cat.length === 0 ? <Empty texto="Nenhum gasto no período" /> : <>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("gastos", [["Data", "Descrição", "Categoria", "Valor"], ...dados!.gastos.map((g) => [g.data, g.descricao, CAT_GASTO[g.categoria], String(g.valor).replace(".", ",")])])}><Download className="h-4 w-4" /> CSV</Button>}>Total: {brl(totalGastos)}</CardTitle>
            <div className="h-72"><ResponsiveContainer><BarChart data={r.cat} layout="vertical" margin={{ left: 30 }}>
              <XAxis type="number" fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} /><YAxis type="category" dataKey="categoria" tickFormatter={(c) => CAT_GASTO[c] || c} fontSize={12} width={100} />
              <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(c) => CAT_GASTO[String(c)] || String(c)} />
              <Bar dataKey="valor" radius={[0, 3, 3, 0]}>{r.cat.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
            <Table head={["Categoria", "Valor", "%"]}>{r.cat.map((c) => <tr key={c.categoria}><Td>{CAT_GASTO[c.categoria]}</Td><Td className="tnum">{brl(c.valor)}</Td><Td className="tnum">{num((c.valor / totalGastos) * 100, 1)}%</Td></tr>)}</Table>
          </>)}
          {aba === "vendas" && (r.mes.length === 0 ? <Empty texto="Nenhum pedido no período" /> : <>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("faturamento", [["Mês", "Faturamento", "Custo", "Lucro bruto", "Recebido"], ...r.mes.map(([m, v]) => [m, v.fat, v.custo, v.fat - v.custo, v.rec].map((x) => String(x).replace(".", ",")))])}><Download className="h-4 w-4" /> CSV</Button>}>Faturamento por mês</CardTitle>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Faturamento" valor={brl(r.mes.reduce((s, [, v]) => s + v.fat, 0))} /><Kpi label="Recebido" valor={brl(r.mes.reduce((s, [, v]) => s + v.rec, 0))} />
              <Kpi label="Lucro bruto" valor={brl(r.mes.reduce((s, [, v]) => s + v.fat - v.custo, 0))} /><Kpi label="Ticket médio" valor={brl(dados!.pedidos.length ? r.mes.reduce((s, [, v]) => s + v.fat, 0) / dados!.pedidos.length : 0)} />
            </div>
            <Table head={["Mês", "Faturamento", "Custo", "Lucro bruto", "Recebido"]}>{r.mes.map(([m, v]) => <tr key={m}><Td>{m}</Td><Td className="tnum">{brl(v.fat)}</Td><Td className="tnum">{brl(v.custo)}</Td><Td className="tnum">{brl(v.fat - v.custo)}</Td><Td className="tnum">{brl(v.rec)}</Td></tr>)}</Table>
          </>)}
          {aba === "clientes" && (r.cli.length === 0 ? <Empty texto="Nenhum pedido no período" /> : <>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("clientes", [["Cliente", "Pedidos", "Faturamento", "Lucro bruto"], ...r.cli.map(([c, v]) => [c, v.n, String(v.total).replace(".", ","), String(v.total - v.custo).replace(".", ",")])])}><Download className="h-4 w-4" /> CSV</Button>}>Clientes no período</CardTitle>
            <Table head={["Cliente", "Pedidos", "Faturamento", "Lucro bruto", "Ticket médio"]}>{r.cli.map(([c, v]) => <tr key={c}><Td>{c}</Td><Td className="tnum">{v.n}</Td><Td className="tnum">{brl(v.total)}</Td><Td className="tnum">{brl(v.total - v.custo)}</Td><Td className="tnum">{brl(v.total / v.n)}</Td></tr>)}</Table>
          </>)}
          {aba === "materia" && (r.mat.length === 0 ? <Empty texto="Nenhuma saída de matéria-prima no período" /> : <>
            <CardTitle right={<Button size="sm" variant="secondary" onClick={() => csv("consumo-materia-prima", [["Item", "Quantidade", "Unidade", "Valor"], ...r.mat.map(([k, v]) => [k, String(v.q).replace(".", ","), v.un, String(v.valor.toFixed(2)).replace(".", ",")])])}><Download className="h-4 w-4" /> CSV</Button>}>Materiais mais consumidos</CardTitle>
            <Table head={["Item", "Consumo", "Valor (custo médio)"]}>{r.mat.map(([k, v]) => <tr key={k}><Td>{k}</Td><Td className="tnum">{num(v.q)} {v.un}</Td><Td className="tnum">{brl(v.valor)}</Td></tr>)}</Table>
            <p className="mt-3 text-xs text-slate-500">Inclui saídas manuais, consumo de bobinas e de reservas. Desperdício por material passa a ser medido com as ordens de produção (Fase 3).</p>
          </>)}
          {aba === "orcamentos" && (!dados!.orcs.length ? <Empty texto="Nenhum orçamento no período" /> : <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Criados" valor={dados!.orcs.length} /><Kpi label="Enviados" valor={enviados} /><Kpi label="Aprovados" valor={aprovados} />
              <Kpi label="Taxa de conversão" valor={`${enviados ? Math.round((aprovados / enviados) * 100) : 0}%`} />
            </div>
            <Table head={["Situação", "Quantidade", "Valor"]}>{Object.entries(r.st).map(([s, v]) => <tr key={s}><Td>{STATUS_ORCAMENTO[s]}</Td><Td className="tnum">{v.n}</Td><Td className="tnum">{brl(v.total)}</Td></tr>)}</Table>
          </>)}
        </Card>
      )}
    </>
  );
}
