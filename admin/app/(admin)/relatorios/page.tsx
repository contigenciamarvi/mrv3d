"use client";
import { useCallback, useEffect, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, RefreshCw } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { data, STATUS_ASSINATURA } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Kpi, Loading, Select, Table, Td, tomStatus } from "@/components/ui";

type Rel = {
  totais: { empresas: number; ativas_30d: number; sem_acesso_14d: number; ativadas: number; tempo_ate_1o_orcamento_dias: number | null };
  funil: { cadastradas: number; impressora: number; material: number; orcamento: number; pedido: number; pagante: number };
  mensal: { mes: string; novas: number; ativadas: number; canceladas: number; total_fim_mes: number }[];
  safras: { safra: string; empresas: number; ainda_ativas: number; pagantes: number; retencao_pct: number | null }[];
  por_plano: { plano: string; empresas: number; usuarios_media: number; impressoras_media: number; pedidos_30d_media: number; orcamentos_30d_media: number }[];
  em_risco: { empresa_id: string; empresa: string; plano: string | null; status_assinatura: string | null; ultimo_acesso: string; pedidos_30d: number }[];
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const dec = (v: number | null) => (v == null ? "—" : String(v).replace(".", ","));

function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
  const csv = linhas.map((l) => l.map((c) => { const s = c == null ? "" : String(c); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click(); URL.revokeObjectURL(a.href);
}

/** Crescimento, ativação e retenção das lojas — só contagens, sem dados de clientes ou valores das lojas */
export default function Relatorios() {
  const [meses, setMeses] = useState(12);
  const [d, setD] = useState<Rel | null>(null);
  const [falha, setFalha] = useState("");
  const carregar = useCallback(async () => { setFalha(""); try { setD(await rpc<Rel>("admin_relatorios", { p_meses: meses })); } catch (e) { setFalha((e as Error).message); } }, [meses]);
  useEffect(() => { carregar(); }, [carregar]);
  const f = d?.funil;
  const etapas = f ? [["Cadastraram", f.cadastradas], ["Cadastraram impressora", f.impressora], ["Cadastraram material", f.material], ["Fizeram orçamento", f.orcamento], ["Registraram pedido", f.pedido], ["Pagantes", f.pagante]] as [string, number][] : [];

  return (
    <>
      <PageHeader titulo="Relatórios" sub="Crescimento, ativação e retenção das lojas. Apenas contagens: nada de clientes, arquivos ou valores das lojas."
        acoes={<div className="flex gap-2">
          <Select value={meses} onChange={(e) => setMeses(Number(e.target.value))} aria-label="Período">{[6, 12, 24].map((m) => <option key={m} value={m}>Últimos {m} meses</option>)}</Select>
          <Button variant="secondary" onClick={carregar}><RefreshCw className="h-4 w-4" /></Button>
          {d && <Button variant="secondary" onClick={() => baixarCsv(`relatorios-plataforma-${new Date().toISOString().slice(0, 10)}.csv`, [
            ["Mês", "Novas lojas", "Ativadas", "Canceladas", "Total no fim do mês"], ...d.mensal.map((m) => [m.mes, m.novas, m.ativadas, m.canceladas, m.total_fim_mes]),
            [], ["Safra", "Lojas", "Ainda ativas", "Pagantes", "Retenção %"], ...d.safras.map((s) => [s.safra, s.empresas, s.ainda_ativas, s.pagantes, dec(s.retencao_pct)]),
            [], ["Plano", "Lojas", "Usuários (média)", "Impressoras (média)", "Pedidos 30d (média)", "Orçamentos 30d (média)"],
            ...d.por_plano.map((p) => [p.plano, p.empresas, dec(p.usuarios_media), dec(p.impressoras_media), dec(p.pedidos_30d_media), dec(p.orcamentos_30d_media)])])}><Download className="h-4 w-4" /> CSV</Button>}
        </div>} />
      {falha && <ErrorBox erro={falha} />}
      {!d && !falha ? <Loading /> : d && f && <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Lojas cadastradas" valor={d.totais.empresas} />
          <Kpi label="Acessaram em 30 dias" valor={d.totais.ativas_30d} sub={pct(d.totais.ativas_30d, d.totais.empresas)} />
          <Kpi label="Ativadas" valor={d.totais.ativadas} sub="Fizeram orçamento ou pedido" />
          <Kpi label="Dias até o 1º orçamento" valor={dec(d.totais.tempo_ate_1o_orcamento_dias)} sub="Média" />
          <Kpi label="Sem acesso há 14+ dias" valor={d.totais.sem_acesso_14d} tom={d.totais.sem_acesso_14d ? "vermelho" : undefined} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle>Crescimento por mês</CardTitle>
            <div className="h-72"><ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.mensal.map((m) => ({ ...m, rotulo: rot(m.mes) }))} barGap={2}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis yAxisId="b" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={30} />
                <YAxis yAxisId="t" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={40} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,.12)" }} /><Legend iconType="circle" />
                <Bar yAxisId="b" dataKey="novas" name="Novas lojas" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="b" dataKey="ativadas" name="Ativadas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="b" dataKey="canceladas" name="Canceladas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Line yAxisId="t" dataKey="total_fim_mes" name="Total de lojas" stroke="#0f172a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer></div>
          </Card>
          <Card>
            <CardTitle>Funil de ativação</CardTitle>
            <ul className="space-y-3">{etapas.map(([r, n]) => (
              <li key={r}><div className="flex justify-between text-sm"><span>{r}</span><span className="tnum font-medium">{n} <span className="text-xs font-normal text-slate-500">{pct(n, f.cadastradas)}</span></span></div>
                <div className="mt-1 h-2 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-blue-600" style={{ width: f.cadastradas ? `${(n / f.cadastradas) * 100}%` : 0 }} /></div></li>))}</ul>
            <p className="mt-4 text-xs text-slate-500">Mostra onde as lojas param depois do cadastro.</p>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle>Retenção por safra (mês de cadastro)</CardTitle>
            {!d.safras.length ? <Empty texto="Sem cadastros no período" /> : (
              <Table head={["Safra", "Lojas", "Ainda ativas", "Pagantes", "Retenção"]}>{d.safras.map((s) => (
                <tr key={s.safra}><Td>{rot(s.safra)}</Td><Td>{s.empresas}</Td><Td>{s.ainda_ativas}</Td><Td>{s.pagantes}</Td>
                  <Td><Badge tom={s.retencao_pct == null ? "cinza" : s.retencao_pct >= 80 ? "verde" : s.retencao_pct >= 50 ? "amarelo" : "vermelho"}>{s.retencao_pct == null ? "—" : `${dec(s.retencao_pct)}%`}</Badge></Td></tr>))}</Table>)}
          </Card>
          <Card>
            <CardTitle>Uso médio por plano</CardTitle>
            {!d.por_plano.length ? <Empty texto="Sem lojas" /> : (
              <Table head={["Plano", "Lojas", "Usuários", "Impressoras", "Pedidos 30d", "Orçamentos 30d"]}>{d.por_plano.map((p) => (
                <tr key={p.plano}><Td className="font-medium">{p.plano}</Td><Td>{p.empresas}</Td><Td>{dec(p.usuarios_media)}</Td><Td>{dec(p.impressoras_media)}</Td><Td>{dec(p.pedidos_30d_media)}</Td><Td>{dec(p.orcamentos_30d_media)}</Td></tr>))}</Table>)}
          </Card>
        </div>

        <Card>
          <CardTitle>Lojas em risco (sem acesso há 14 dias ou mais)</CardTitle>
          {!d.em_risco.length ? <Empty texto="Nenhuma loja parada" /> : (
            <Table head={["Loja", "Plano", "Assinatura", "Último acesso", "Pedidos 30d"]}>{d.em_risco.map((e) => (
              <tr key={e.empresa_id}><Td className="font-medium">{e.empresa}</Td><Td>{e.plano || "—"}</Td>
                <Td>{e.status_assinatura ? <Badge tom={tomStatus(e.status_assinatura)}>{STATUS_ASSINATURA[e.status_assinatura] || e.status_assinatura}</Badge> : "—"}</Td>
                <Td>{data(e.ultimo_acesso)}</Td><Td>{e.pedidos_30d}</Td></tr>))}</Table>)}
          <p className="mt-3 text-xs text-slate-500">Boas candidatas para um contato do suporte ou um aviso direcionado (Notificações).</p>
        </Card>
      </div>}
    </>
  );
}
