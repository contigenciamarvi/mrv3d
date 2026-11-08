"use client";
import { useCallback, useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { brl, data, STATUS_ASSINATURA, pode } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Kpi, Loading, Select, Table, Td, tomStatus } from "@/components/ui";

type Fin = {
  kpis: { mrr: number; arr: number; pagantes: number; ticket_medio: number; mrr_em_risco: number; em_teste: number; testes_7d: number; mrr_potencial_testes: number;
    recebido_mes: number; a_receber_30d: number; em_atraso: number; faturas_em_atraso: number; empresas_inadimplentes: number;
    cancelamentos_30d: number; mrr_perdido_30d: number; churn_30d_pct: number | null };
  por_status: Record<string, number>;
  por_plano: { plano: string; assinaturas: number; mrr: number }[];
  mensal: { mes: string; faturado: number; recebido: number; novas: number; cancelamentos: number }[];
  inadimplentes: { empresa_id: string; empresa: string; valor: number; faturas: number; vencimento_mais_antigo: string; dias_atraso: number; status_assinatura: string | null }[];
  proximas: { empresa: string; valor: number; vencimento: string; descricao: string | null }[];
  testes: { empresa_id: string; empresa: string; plano: string | null; teste_ate: string; mrr: number }[];
  cancelados: { empresa: string; plano: string | null; mrr: number; cancelada_em: string; motivo: string | null }[];
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const num = (v: number) => Number(v || 0);

function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
  const csv = linhas.map((l) => l.map((c) => { const s = c == null ? "" : String(c); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = nome; a.click(); URL.revokeObjectURL(a.href);
}
const csvNum = (v: number) => num(v).toFixed(2).replace(".", ",");

/** Receita recorrente da plataforma: só assinaturas e faturas do SaaS, nada das finanças das lojas */
export default function FinanceiroSaas() {
  const { papel } = useSessao();
  const [meses, setMeses] = useState(12);
  const [d, setD] = useState<Fin | null>(null);
  const [falha, setFalha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const carregar = useCallback(async () => {
    setFalha(""); setCarregando(true);
    try { setD(await rpc<Fin>("admin_financeiro", { p_meses: meses })); } catch (e) { setFalha((e as Error).message); } finally { setCarregando(false); }
  }, [meses]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!pode(papel, "gerirCobrancas")) return <><PageHeader titulo="Financeiro SaaS" /><ErrorBox erro="Seu perfil não tem acesso ao financeiro da plataforma." /></>;
  const k = d?.kpis;
  const serie = (d?.mensal || []).map((m) => ({ ...m, rotulo: `${MESES[Number(m.mes.slice(5)) - 1]}/${m.mes.slice(2, 4)}`, faturado: num(m.faturado), recebido: num(m.recebido) }));

  return (
    <>
      <PageHeader titulo="Financeiro SaaS" sub="Receita recorrente, recebimentos, inadimplência e cancelamentos das assinaturas da plataforma"
        acoes={<div className="flex gap-2">
          <Select value={meses} onChange={(e) => setMeses(Number(e.target.value))} aria-label="Período">{[6, 12, 24].map((m) => <option key={m} value={m}>Últimos {m} meses</option>)}</Select>
          <Button variant="secondary" onClick={carregar} disabled={carregando}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
          {d && <Button variant="secondary" onClick={() => baixarCsv(`financeiro-saas-${new Date().toISOString().slice(0, 10)}.csv`, [
            ["Mês", "Faturado", "Recebido", "Novas assinaturas", "Cancelamentos"], ...d.mensal.map((m) => [m.mes, csvNum(m.faturado), csvNum(m.recebido), m.novas, m.cancelamentos]),
            [], ["Inadimplentes"], ["Empresa", "Valor em atraso", "Faturas", "Vencimento mais antigo", "Dias de atraso"],
            ...d.inadimplentes.map((i) => [i.empresa, csvNum(i.valor), i.faturas, i.vencimento_mais_antigo, i.dias_atraso])])}><Download className="h-4 w-4" /> CSV</Button>}
        </div>} />
      {falha && <ErrorBox erro={falha} />}
      {!d && !falha ? <Loading /> : d && k && <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="MRR (receita mensal recorrente)" valor={brl(k.mrr)} sub={`${k.pagantes} assinatura(s) pagante(s) · ticket médio ${brl(k.ticket_medio)}`} />
          <Kpi label="ARR (anualizado)" valor={brl(k.arr)} sub="MRR × 12" />
          <Kpi label="Recebido no mês" valor={brl(k.recebido_mes)} tom="verde" sub={`A receber em 30 dias: ${brl(k.a_receber_30d)}`} />
          <Kpi label="Em atraso" valor={brl(k.em_atraso)} tom={k.em_atraso > 0 ? "vermelho" : undefined} sub={`${k.faturas_em_atraso} fatura(s) · ${k.empresas_inadimplentes} empresa(s)`} />
          <Kpi label="MRR em risco" valor={brl(k.mrr_em_risco)} tom={k.mrr_em_risco > 0 ? "vermelho" : undefined} sub="Assinaturas atrasadas" />
          <Kpi label="Em teste" valor={k.em_teste} sub={`${k.testes_7d} terminam em 7 dias · potencial ${brl(k.mrr_potencial_testes)}/mês`} />
          <Kpi label="Cancelamentos (30 dias)" valor={k.cancelamentos_30d} sub={`MRR perdido: ${brl(k.mrr_perdido_30d)}`} tom={k.cancelamentos_30d > 0 ? "vermelho" : undefined} />
          <Kpi label="Churn (30 dias)" valor={k.churn_30d_pct == null ? "—" : `${String(k.churn_30d_pct).replace(".", ",")}%`} sub="Cancelados ÷ base pagante" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle>Faturado × recebido por mês</CardTitle>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} barGap={2}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis yAxisId="v" tickLine={false} axisLine={false} fontSize={12} width={70} tickFormatter={(v) => brl(v).replace(",00", "")} />
                  <YAxis yAxisId="n" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={30} />
                  <Tooltip formatter={(v, n) => (String(n).startsWith("Assinaturas") || String(n).startsWith("Cancel") ? v : brl(Number(v)))} cursor={{ fill: "rgba(148,163,184,.12)" }} />
                  <Legend iconType="circle" />
                  <Bar yAxisId="v" dataKey="faturado" name="Faturado" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="v" dataKey="recebido" name="Recebido" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="n" dataKey="novas" name="Assinaturas novas" stroke="#059669" strokeWidth={2} dot={false} />
                  <Line yAxisId="n" dataKey="cancelamentos" name="Cancelamentos" stroke="#dc2626" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <CardTitle>MRR por plano</CardTitle>
            {!d.por_plano.length ? <Empty texto="Nenhuma assinatura pagante" /> : (
              <ul className="space-y-3">{d.por_plano.map((p) => (
                <li key={p.plano}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{p.plano} <span className="text-slate-500">· {p.assinaturas}</span></span><span className="tnum">{brl(p.mrr)}</span></div>
                  <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-blue-600" style={{ width: `${k.mrr > 0 ? (num(p.mrr) / k.mrr) * 100 : 0}%` }} /></div>
                </li>))}</ul>)}
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div className="mb-2 text-xs font-medium text-slate-500">Assinaturas por situação</div>
              <div className="flex flex-wrap gap-2">{Object.entries(d.por_status).map(([s, n]) => <Badge key={s} tom={tomStatus(s)}>{STATUS_ASSINATURA[s] || s}: {n}</Badge>)}</div>
            </div>
          </Card>
        </div>

        <Card>
          <CardTitle>Inadimplentes</CardTitle>
          {!d.inadimplentes.length ? <Empty texto="Nenhuma fatura em atraso" /> : (
            <Table head={["Empresa", "Em atraso", "Faturas", "Vencida desde", "Dias", "Assinatura"]}>{d.inadimplentes.map((i) => (
              <tr key={i.empresa_id}><Td className="font-medium">{i.empresa}</Td><Td className="tnum text-red-600">{brl(i.valor)}</Td><Td>{i.faturas}</Td><Td>{data(i.vencimento_mais_antigo)}</Td>
                <Td><Badge tom={i.dias_atraso > 15 ? "vermelho" : "amarelo"}>{i.dias_atraso} dia(s)</Badge></Td>
                <Td>{i.status_assinatura ? <Badge tom={tomStatus(i.status_assinatura)}>{STATUS_ASSINATURA[i.status_assinatura] || i.status_assinatura}</Badge> : "—"}</Td></tr>))}</Table>)}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle>A receber nos próximos 30 dias</CardTitle>
            {!d.proximas.length ? <Empty texto="Nenhuma fatura aberta para os próximos 30 dias" /> : (
              <Table head={["Vencimento", "Empresa", "Valor"]}>{d.proximas.map((p, i) => (
                <tr key={i}><Td>{data(p.vencimento)}</Td><Td><div className="font-medium">{p.empresa}</div>{p.descricao && <div className="text-xs text-slate-500">{p.descricao}</div>}</Td><Td className="tnum">{brl(p.valor)}</Td></tr>))}</Table>)}
          </Card>
          <Card>
            <CardTitle>Testes terminando (14 dias)</CardTitle>
            {!d.testes.length ? <Empty texto="Nenhum teste terminando" /> : (
              <Table head={["Termina", "Empresa", "Plano", "Vale/mês"]}>{d.testes.map((t) => (
                <tr key={t.empresa_id}><Td>{data(t.teste_ate)}</Td><Td className="font-medium">{t.empresa}</Td><Td>{t.plano || "—"}</Td><Td className="tnum">{brl(t.mrr)}</Td></tr>))}</Table>)}
          </Card>
        </div>

        <Card>
          <CardTitle>Cancelamentos (90 dias)</CardTitle>
          {!d.cancelados.length ? <Empty texto="Nenhum cancelamento nos últimos 90 dias" /> : (
            <Table head={["Data", "Empresa", "Plano", "MRR perdido", "Motivo"]}>{d.cancelados.map((c, i) => (
              <tr key={i}><Td>{data(c.cancelada_em)}</Td><Td className="font-medium">{c.empresa}</Td><Td>{c.plano || "—"}</Td><Td className="tnum">{brl(c.mrr)}</Td><Td className="text-sm text-slate-600">{c.motivo || "—"}</Td></tr>))}</Table>)}
        </Card>
        <p className="text-xs text-slate-500">MRR soma as assinaturas ativas, pendentes e atrasadas, com desconto aplicado e planos anuais divididos por 12. Testes não entram no MRR. Valores vêm das faturas registradas na plataforma.</p>
      </div>}
    </>
  );
}
