"use client";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, CartesianGrid } from "recharts";
import { Download } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { brl, num, data, hojeISO, CAT_GASTO, STATUS_PEDIDO, baixarCsv, csvNum, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Input, Select, Table, Td, Loading, ErrorBox, Empty } from "@/components/ui";

const CORES = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04", "#64748b"];
type Col = { chave: string; titulo: string; tipo: "texto" | "moeda" | "numero" | "pct" | "data" | "horas" };
type Rel = { colunas: Col[]; linhas: Record<string, string | number | null>[] };

const RELATORIOS: { grupo: string; itens: [string, string, string][] }[] = [
  { grupo: "Vendas", itens: [
    ["faturamento", "Faturamento por período", "Pedidos, faturamento, recebido e ticket médio por mês"],
    ["orcamentos", "Orçamentos e conversão", "Criados, enviados, aprovados e taxa de conversão comercial"],
    ["rentabilidade_cliente", "Rentabilidade por cliente", "Faturamento, custo, lucro, margem e saldo a receber"],
    ["pedidos_atrasados", "Pedidos atrasados", "Prazo vencido antes da entrega (com prazo no período)"],
  ] },
  { grupo: "Lucro", itens: [
    ["lucro_pedido", "Lucro por pedido", "Usa o custo real quando a produção terminou; senão, o estimado"],
    ["lucro_produto", "Lucro por produto", "Receita vendida × custo real produzido (inclui reimpressões)"],
    ["lucro_impressora", "Lucro por impressora", "Receita atribuída às ordens × custo de produção e lucro por hora"],
  ] },
  { grupo: "Produção", itens: [
    ["maquinas", "Máquinas mais produtivas", "Horas impressas, falhas, tempo parado e custo de manutenção"],
    ["falhas", "Falhas e reimpressões", "Motivos, material e horas perdidos e custo das reimpressões"],
    ["producao_operador", "Produção por operador", "Ordens, peças, horas e taxa de falha"],
    ["manutencao", "Custos de manutenção", "Preventivas, corretivas, custo e horas paradas por impressora"],
  ] },
  { grupo: "Estoque e compras", itens: [
    ["materiais_consumidos", "Materiais mais consumidos", "Saídas do estoque no período (custo médio)"],
    ["desperdicio", "Desperdício de material", "Perdas registradas nas ordens e material perdido em falhas"],
    ["estoque_valorizado", "Estoque valorizado", "Saldo atual × custo médio (não depende do período)"],
    ["compras_fornecedor", "Compras por fornecedor", "Total comprado e prazo real × prazo informado"],
  ] },
  { grupo: "Financeiro", itens: [["fluxo_caixa", "Fluxo de caixa diário", "Entradas e saídas efetivas por dia, com saldo acumulado"]] },
];
const TITULOS = Object.fromEntries(RELATORIOS.flatMap((g) => g.itens.map(([k, t, d]) => [k, { t, d }])));

const fmt = (v: unknown, t: Col["tipo"]) => {
  if (v == null || v === "") return "—";
  if (t === "moeda") return brl(Number(v));
  if (t === "numero") return num(Number(v), 2);
  if (t === "horas") return `${num(Number(v), 1)} h`;
  if (t === "pct") return `${num(Number(v), 1)}%`;
  if (t === "data") return data(String(v));
  return STATUS_PEDIDO[String(v)] || String(v);
};

export default function Relatorios() { return <Exige perm={["relatorios_ver", "financeiro_ver", "compras_gerenciar"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const avancados = app.pode("relatorios_ver");
  const [inicio, setInicio] = useState(hojeISO(-29));
  const [fim, setFim] = useState(hojeISO());
  const [tipo, setTipo] = useState(avancados ? "faturamento" : "gastos");
  return (
    <>
      <PageHeader titulo="Relatórios" sub="Todos com filtro de período e exportação CSV"
        acoes={<><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" aria-label="Início" /><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" aria-label="Fim" /></>} />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Relatórios">
          <Select className="lg:hidden" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Relatório">
            {avancados && RELATORIOS.map((g) => <optgroup key={g.grupo} label={g.grupo}>{g.itens.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</optgroup>)}
            <option value="gastos">Gastos por categoria</option></Select>
          <div className="hidden space-y-4 lg:block">
            {avancados && RELATORIOS.map((g) => (
              <div key={g.grupo}><div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.grupo}</div>
                {g.itens.map(([k, t]) => <button key={k} onClick={() => setTipo(k)} className={cn("block w-full rounded-lg px-2 py-1.5 text-left text-sm", tipo === k ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-400" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>{t}</button>)}</div>))}
            <div><div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Gastos</div>
              <button onClick={() => setTipo("gastos")} className={cn("block w-full rounded-lg px-2 py-1.5 text-left text-sm", tipo === "gastos" ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/10" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>Gastos por categoria</button></div>
          </div>
        </nav>
        {tipo === "gastos" ? <Gastos inicio={inicio} fim={fim} /> : <Relatorio tipo={tipo} inicio={inicio} fim={fim} />}
      </div>
    </>
  );
}

function Relatorio({ tipo, inicio, fim }: { tipo: string; inicio: string; fim: string }) {
  const app = useApp();
  const { dados, carregando, erro, recarregar } = useDados(() => rpc<Rel>("relatorio", { p_empresa: app.empresa.id, p_tipo: tipo, p_inicio: inicio, p_fim: fim }), [app.empresa.id, tipo, inicio, fim]);
  const numericas = useMemo(() => (dados?.colunas || []).filter((c) => ["moeda", "numero", "horas", "pct"].includes(c.tipo)), [dados]);
  const [serie, setSerie] = useState("");
  const col = numericas.find((c) => c.chave === serie) || numericas[0];
  const rotulo = dados?.colunas[0];
  const grafico = useMemo(() => (dados && col && rotulo ? dados.linhas.slice(0, 25).map((l) => ({ nome: String(fmt(l[rotulo.chave], rotulo.tipo)), valor: Number(l[col.chave] || 0) })) : []), [dados, col, rotulo]);
  const totais = useMemo(() => (dados?.colunas || []).map((c) => ["moeda", "horas"].includes(c.tipo) || (c.tipo === "numero" && !/prazo|dias/.test(c.chave)) ? dados!.linhas.reduce((s, l) => s + Number(l[c.chave] || 0), 0) : null), [dados]);
  const info = TITULOS[tipo];
  return (
    <Card>
      <CardTitle right={dados && dados.linhas.length > 0 && <Button size="sm" variant="secondary" onClick={() => baixarCsv(`${tipo}_${inicio}_${fim}`, [dados.colunas.map((c) => c.titulo),
        ...dados.linhas.map((l) => dados.colunas.map((c) => ["moeda", "numero", "horas", "pct"].includes(c.tipo) ? csvNum(l[c.chave]) : c.tipo === "texto" ? fmt(l[c.chave], c.tipo) : l[c.chave]))])}>
        <Download className="h-4 w-4" /> CSV</Button>}>
        <span>{info?.t}<span className="block text-xs font-normal text-slate-500">{info?.d}</span></span></CardTitle>
      {erro ? <ErrorBox erro={erro} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !dados?.linhas.length ? <Empty texto="Sem dados no período" /> : <>
        {col && grafico.length > 1 && <>
          {numericas.length > 1 && <div className="mb-2 flex justify-end"><Select value={col.chave} onChange={(e) => setSerie(e.target.value)} className="w-56" aria-label="Gráfico">{numericas.map((c) => <option key={c.chave} value={c.chave}>{c.titulo}</option>)}</Select></div>}
          <div className="mb-4 h-64"><ResponsiveContainer><BarChart data={grafico}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="nome" fontSize={11} interval={0} angle={grafico.length > 8 ? -30 : 0} textAnchor={grafico.length > 8 ? "end" : "middle"} height={grafico.length > 8 ? 70 : 30} tickFormatter={(v) => String(v).slice(0, 18)} />
            <YAxis fontSize={11} width={70} tickFormatter={(v) => col.tipo === "moeda" ? `R$${num(v, 0)}` : num(v, 1)} />
            <Tooltip formatter={(v) => fmt(v, col.tipo)} />
            <Bar dataKey="valor" name={col.titulo} radius={[3, 3, 0, 0]}>{grafico.map((g, i) => <Cell key={i} fill={g.valor < 0 ? "#dc2626" : CORES[0]} />)}</Bar></BarChart></ResponsiveContainer></div></>}
        <Table head={dados.colunas.map((c) => c.titulo)}>
          {dados.linhas.map((l, i) => <tr key={i}>{dados.colunas.map((c) => <Td key={c.chave} className={cn(c.tipo !== "texto" && c.tipo !== "data" && "tnum whitespace-nowrap", (c.chave === "lucro" || c.chave === "saldo") && Number(l[c.chave]) < 0 && "text-red-600")}>{fmt(l[c.chave], c.tipo)}</Td>)}</tr>)}
          {dados.linhas.length > 1 && totais.some((t) => t != null) && <tr className="font-semibold">{dados.colunas.map((c, i) => <Td key={c.chave} className="tnum whitespace-nowrap">{i === 0 ? "Total" : totais[i] != null && c.chave !== "acumulado" ? fmt(totais[i], c.tipo) : ""}</Td>)}</tr>}
        </Table>
      </>}
    </Card>
  );
}

function Gastos({ inicio, fim }: { inicio: string; fim: string }) {
  const app = useApp();
  const { dados, carregando, erro, recarregar } = useDados(() => q<{ categoria: string; valor: number; data: string; descricao: string }[]>(sb().from("gastos").select("categoria,valor,data,descricao").eq("empresa_id", app.empresa.id).gte("data", inicio).lte("data", fim)), [app.empresa.id, inicio, fim]);
  const cat = useMemo(() => {
    const m: Record<string, number> = {};
    (dados || []).forEach((g) => { m[g.categoria] = (m[g.categoria] || 0) + Number(g.valor); });
    return Object.entries(m).map(([categoria, valor]) => ({ categoria, valor })).sort((a, b) => b.valor - a.valor);
  }, [dados]);
  const total = cat.reduce((s, c) => s + c.valor, 0);
  return (
    <Card>
      {erro ? <ErrorBox erro={erro} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !cat.length ? <Empty texto="Nenhum gasto no período" /> : <>
        <CardTitle right={<Button size="sm" variant="secondary" onClick={() => baixarCsv("gastos", [["Data", "Descrição", "Categoria", "Valor"], ...dados!.map((g) => [g.data, g.descricao, CAT_GASTO[g.categoria], csvNum(g.valor)])])}><Download className="h-4 w-4" /> CSV</Button>}>
          Gastos por categoria — {brl(total)}<span className="block text-xs font-normal text-slate-500">Compras rápidas e gastos avulsos. Contas a pagar ficam no Financeiro.</span></CardTitle>
        <div className="h-72"><ResponsiveContainer><BarChart data={cat} layout="vertical" margin={{ left: 30 }}>
          <XAxis type="number" fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} /><YAxis type="category" dataKey="categoria" tickFormatter={(c) => CAT_GASTO[c] || c} fontSize={12} width={100} />
          <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(c) => CAT_GASTO[String(c)] || String(c)} />
          <Bar dataKey="valor" radius={[0, 3, 3, 0]}>{cat.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
        <Table head={["Categoria", "Valor", "%"]}>{cat.map((c) => <tr key={c.categoria}><Td>{CAT_GASTO[c.categoria]}</Td><Td className="tnum">{brl(c.valor)}</Td><Td className="tnum">{num((c.valor / total) * 100, 1)}%</Td></tr>)}</Table>
      </>}
    </Card>
  );
}
