"use client";
import { useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Legend } from "recharts";
import { SlidersHorizontal } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { brl, num, data, hojeISO, CAT_GASTO, STATUS_PEDIDO } from "@/lib/utils";
import { Card, CardTitle, Kpi, Loading, ErrorBox, Empty, Input, Field, Select, Badge, tomStatus, Modal, Checkbox, Button } from "@/components/ui";

type Dash = {
  permissoes: Record<string, boolean>;
  faturamento_dia?: number; faturamento_mes?: number; faturamento_periodo?: number; lucro_bruto?: number; lucro_liquido_estimado?: number;
  custos_fixos_periodo?: number; contas_pagar?: number; ordens_ativas?: number; recebido_periodo?: number; despesas_periodo?: number; caixa_periodo?: number; contas_receber?: number;
  pedidos_recebidos?: number; pedidos_producao?: number; pedidos_atrasados?: number; orcamentos_aguardando?: number;
  orcamentos_aprovados_periodo?: number; orcamentos_enviados_periodo?: number; alertas_estoque?: number;
  impressoras?: { disponiveis: number; funcionando: number; manutencao: number; paradas: number; total: number };
  proximas_entregas?: { id: string; numero: number; descricao: string; cliente: string; data_entrega: string; status: string }[];
  mais_vendidos?: { nome: string; quantidade: number }[];
  consumo_materia?: { nome: string; unidade: string; quantidade: number; valor: number }[];
  vendas_diarias?: { dia: string; valor: number }[];
  mensal?: { mes: string; faturamento: number; lucro: number }[];
  custos_categoria?: { categoria: string; valor: number }[];
  producao_mensal?: { mes: string; entregues: number }[];
};
const BLOCOS: [string, string][] = [
  ["financeiro", "Indicadores financeiros"], ["operacao", "Pedidos e orçamentos"], ["impressoras", "Impressoras"],
  ["vendas", "Gráfico de vendas diárias"], ["mensal", "Faturamento e lucro por mês"], ["custos", "Custos por categoria"],
  ["producao", "Produção por mês"], ["entregas", "Próximas entregas"], ["vendidos", "Produtos mais vendidos"], ["consumo", "Consumo de matéria-prima"],
];
const CORES = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#ca8a04", "#64748b"];
const mesCurto = (m: string) => new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");

export default function Dashboard() {
  const app = useApp();
  const [periodo, setPeriodo] = useState("30");
  const [inicio, setInicio] = useState(hojeISO(-29));
  const [fim, setFim] = useState(hojeISO());
  const [ocultos, setOcultos] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("dash-ocultos") || "[]"); } catch { return []; } });
  const [personalizar, setPersonalizar] = useState(false);
  const { dados: d, carregando, erro, recarregar } = useDados(
    () => rpc<Dash>("painel_dashboard", { p_empresa: app.empresa.id, p_inicio: inicio, p_fim: fim }), [app.empresa.id, inicio, fim]);

  const mudarPeriodo = (v: string) => {
    setPeriodo(v);
    if (v === "mes") { const h = hojeISO(); setInicio(h.slice(0, 8) + "01"); setFim(h); }
    else if (v !== "personalizado") { setInicio(hojeISO(-(Number(v) - 1))); setFim(hojeISO()); }
  };
  const ver = (b: string) => !ocultos.includes(b);
  const alternar = (b: string) => {
    const n = ocultos.includes(b) ? ocultos.filter((x) => x !== b) : [...ocultos, b];
    setOcultos(n); try { localStorage.setItem("dash-ocultos", JSON.stringify(n)); } catch {}
  };

  return (
    <>
      <PageHeader titulo={`Olá! Visão geral da ${app.empresa.nome}`} sub="Os números consideram o período escolhido, exceto onde indicado."
        acoes={<>
          <Select value={periodo} onChange={(e) => mudarPeriodo(e.target.value)} className="w-40" aria-label="Período">
            <option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="mes">Este mês</option>
            <option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option><option value="personalizado">Personalizado</option>
          </Select>
          {periodo === "personalizado" && <>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" aria-label="Início" />
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" aria-label="Fim" />
          </>}
          <Button variant="secondary" onClick={() => setPersonalizar(true)}><SlidersHorizontal className="h-4 w-4" /> Personalizar</Button>
        </>} />

      {erro && <ErrorBox erro={erro} onRetry={recarregar} />}
      {carregando && !d && <Loading />}
      {d && (
        <div className="space-y-6">
          {d.permissoes.financeiro && ver("financeiro") && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Faturamento hoje" valor={brl(d.faturamento_dia)} />
              <Kpi label="Faturamento no mês" valor={brl(d.faturamento_mes)} />
              <Kpi label="Faturamento no período" valor={brl(d.faturamento_periodo)} />
              <Kpi label="Lucro bruto" valor={brl(d.lucro_bruto)} sub="Vendas − custo de produção (real quando registrado)" tom={(d.lucro_bruto || 0) >= 0 ? "verde" : "vermelho"} />
              <Kpi label="Lucro líquido estimado" valor={brl(d.lucro_liquido_estimado)} sub={`Já desconta ${brl(d.custos_fixos_periodo)} de custos fixos`} tom={(d.lucro_liquido_estimado || 0) >= 0 ? "verde" : "vermelho"} />
              <Kpi label="Caixa do período" valor={brl(d.caixa_periodo)} sub={`Recebido ${brl(d.recebido_periodo)} − despesas ${brl(d.despesas_periodo)}`} />
              <Kpi label="Contas a receber" valor={brl(d.contas_receber)} sub="Saldo em aberto de todos os pedidos" />
              <Kpi label="Contas a pagar" valor={brl(d.contas_pagar)} sub={<Link href="/financeiro/?aba=pagar" className="underline">Ver contas</Link>} />
            </div>
          )}

          {ver("operacao") && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {d.permissoes.pedidos && <>
                <Kpi label="Pedidos recebidos" valor={num(d.pedidos_recebidos, 0)} />
                <Kpi label="Em produção" valor={num(d.pedidos_producao, 0)} sub={d.ordens_ativas != null ? <Link href="/producao/" className="underline">{d.ordens_ativas} ordem(ns) ativa(s)</Link> : "Agora"} />
                <Kpi label="Atrasados" valor={num(d.pedidos_atrasados, 0)} tom={(d.pedidos_atrasados || 0) > 0 ? "vermelho" : undefined} sub="Agora" />
              </>}
              {d.permissoes.orcamentos && <Kpi label="Orçamentos aguardando" valor={num(d.orcamentos_aguardando, 0)}
                sub={`${d.orcamentos_aprovados_periodo} aprovado(s) de ${d.orcamentos_enviados_periodo} enviado(s) no período`} />}
              {d.permissoes.materia && <Kpi label="Alertas de estoque" valor={num(d.alertas_estoque, 0)} tom={(d.alertas_estoque || 0) > 0 ? "vermelho" : undefined}
                sub={<Link href="/materia-prima/?aba=reposicao" className="underline">Lista de reposição</Link>} />}
            </div>
          )}

          {d.impressoras && ver("impressoras") && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Impressoras disponíveis" valor={d.impressoras.disponiveis} sub={`de ${d.impressoras.total}`} />
              <Kpi label="Em funcionamento" valor={d.impressoras.funcionando} />
              <Kpi label="Em manutenção" valor={d.impressoras.manutencao} tom={d.impressoras.manutencao > 0 ? "vermelho" : undefined} />
              <Kpi label="Pausadas ou inativas" valor={d.impressoras.paradas} />
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {d.vendas_diarias && ver("vendas") && (
              <Card><CardTitle>Vendas diárias</CardTitle>
                <div className="h-64"><ResponsiveContainer>
                  <BarChart data={d.vendas_diarias}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="dia" tickFormatter={(v) => data(v).slice(0, 5)} fontSize={11} minTickGap={16} />
                    <YAxis fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} width={60} />
                    <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => data(String(l))} />
                    <Bar dataKey="valor" name="Vendas" fill="#2563eb" radius={[3, 3, 0, 0]} /></BarChart>
                </ResponsiveContainer></div>
              </Card>
            )}
            {d.mensal && ver("mensal") && (
              <Card><CardTitle>Faturamento e lucro por mês</CardTitle>
                <div className="h-64"><ResponsiveContainer>
                  <LineChart data={d.mensal}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tickFormatter={mesCurto} fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} width={60} />
                    <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(l) => mesCurto(String(l))} /><Legend />
                    <Line dataKey="faturamento" name="Faturamento" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line dataKey="lucro" name="Lucro (após custos fixos)" stroke="#16a34a" strokeWidth={2} dot={false} /></LineChart>
                </ResponsiveContainer></div>
              </Card>
            )}
            {d.custos_categoria && ver("custos") && (
              <Card><CardTitle>Custos por categoria</CardTitle>
                {d.custos_categoria.length === 0 ? <Empty texto="Nenhum gasto no período" /> : (
                  <div className="h-64"><ResponsiveContainer>
                    <BarChart data={d.custos_categoria} layout="vertical" margin={{ left: 20 }}>
                      <XAxis type="number" fontSize={11} tickFormatter={(v) => `R$${num(v, 0)}`} /><YAxis type="category" dataKey="categoria" tickFormatter={(c) => CAT_GASTO[c] || c} fontSize={12} width={90} />
                      <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={(c) => CAT_GASTO[String(c)] || String(c)} />
                      <Bar dataKey="valor" name="Valor" radius={[0, 3, 3, 0]}>{d.custos_categoria.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer></div>
                )}
              </Card>
            )}
            {d.producao_mensal && ver("producao") && (
              <Card><CardTitle>Pedidos entregues por mês</CardTitle>
                <div className="h-64"><ResponsiveContainer>
                  <BarChart data={d.producao_mensal}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tickFormatter={mesCurto} fontSize={11} /><YAxis fontSize={11} allowDecimals={false} width={30} />
                    <Tooltip labelFormatter={(l) => mesCurto(String(l))} /><Bar dataKey="entregues" name="Entregues" fill="#0891b2" radius={[3, 3, 0, 0]} /></BarChart>
                </ResponsiveContainer></div>
              </Card>
            )}
            {d.proximas_entregas && ver("entregas") && (
              <Card><CardTitle right={<Link href="/pedidos/" className="text-sm text-brand-600">Ver pedidos</Link>}>Próximas entregas</CardTitle>
                {d.proximas_entregas.length === 0 ? <Empty texto="Nenhuma entrega programada" /> : (
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    {d.proximas_entregas.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0"><div className="truncate font-medium">#{p.numero} {p.descricao}</div><div className="text-xs text-slate-500">{p.cliente || "Sem cliente"}</div></div>
                        <div className="shrink-0 text-right"><div className={p.data_entrega < hojeISO() ? "font-medium text-red-600" : ""}>{data(p.data_entrega)}</div><Badge tom={tomStatus(p.status)}>{STATUS_PEDIDO[p.status]}</Badge></div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
            {d.mais_vendidos && ver("vendidos") && (
              <Card><CardTitle>Produtos mais vendidos</CardTitle>
                {d.mais_vendidos.length === 0 ? <Empty texto="Sem vendas no período" /> : (
                  <ol className="space-y-2 text-sm">{d.mais_vendidos.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{i + 1}. {p.nome}</span><span className="tnum shrink-0 font-medium">{num(p.quantidade)} un</span></li>
                  ))}</ol>
                )}
              </Card>
            )}
            {d.consumo_materia && ver("consumo") && (
              <Card><CardTitle right={<Link href="/materia-prima/" className="text-sm text-brand-600">Matéria-prima</Link>}>Consumo de matéria-prima</CardTitle>
                {d.consumo_materia.length === 0 ? <Empty texto="Nenhuma saída no período" /> : (
                  <ul className="space-y-2 text-sm">{d.consumo_materia.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2"><span className="truncate">{c.nome}</span>
                      <span className="tnum shrink-0">{num(c.quantidade)} {c.unidade}{app.pode("custos_ver") && <span className="ml-2 text-slate-500">{brl(c.valor)}</span>}</span></li>
                  ))}</ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      <Modal aberto={personalizar} titulo="Personalizar o dashboard" onClose={() => setPersonalizar(false)}>
        <p className="mb-3 text-sm text-slate-500">Escolha o que aparece. A escolha fica salva neste navegador.</p>
        <div className="space-y-2">{BLOCOS.map(([k, l]) => <Checkbox key={k} label={l} checked={ver(k)} onChange={() => alternar(k)} />)}</div>
      </Modal>
    </>
  );
}
