"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { rpc } from "@/lib/supabase";
import { brl, hojeISO } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Card, CardTitle, ErrorBox, Kpi, Loading, Select, Table, Td } from "@/components/ui";

type Dash = {
  empresas: { total: number; teste: number; ativa: number; suspensa: number; cancelada: number; novas_periodo: number };
  usuarios: number;
  assinaturas: { ativas: number; em_teste: number; atrasadas: number; novas_periodo: number };
  cancelamentos_periodo: number; churn_percentual: number | null;
  mrr: number; arr: number; faturado_periodo: number; recebido_periodo: number;
  pendente: { qtd: number; valor: number }; atrasado: { qtd: number; valor: number };
  inadimplencia_percentual: number | null;
  por_plano: { plano: string; ativas: number; teste: number; mrr: number }[];
  evolucao: { mes: string; faturado: number; recebido: number; novas_empresas: number }[];
};

function periodo(p: string): [string, string] {
  const h = hojeISO(); const d = new Date(h + "T12:00:00");
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (p === "mes_passado") { const i = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12); const f = new Date(d.getFullYear(), d.getMonth(), 0, 12); return [iso(i), iso(f)]; }
  if (p === "90d") { const i = new Date(d); i.setDate(i.getDate() - 90); return [iso(i), h]; }
  if (p === "ano") return [h.slice(0, 4) + "-01-01", h];
  return [h.slice(0, 8) + "01", h];
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (v: number | null) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR")}%`);

export default function Dashboard() {
  const [p, setP] = useState("mes");
  const [d, setD] = useState<Dash | null>(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setErro(""); setD(null);
    try { const [i, f] = periodo(p); setD(await rpc<Dash>("admin_dashboard", { p_inicio: i, p_fim: f })); }
    catch (e) { setErro((e as Error).message); }
  }, [p]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <>
      <PageHeader titulo="Dashboard" sub="Visão geral da plataforma"
        acoes={<Select value={p} onChange={(e) => setP(e.target.value)} className="w-auto" aria-label="Período">
          <option value="mes">Este mês</option><option value="mes_passado">Mês passado</option>
          <option value="90d">Últimos 90 dias</option><option value="ano">Este ano</option>
        </Select>} />
      {erro && <ErrorBox erro={erro} onRetry={carregar} />}
      {!d && !erro && <Loading />}
      {d && (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Receita</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="MRR (recorrente contratado)" valor={brl(d.mrr)} sub="Assinaturas ativas, valor mensal" />
              <Kpi label="ARR estimado" valor={brl(d.arr)} sub="MRR × 12" />
              <Kpi label="Faturado no período" valor={brl(d.faturado_periodo)} sub="Faturas emitidas" />
              <Kpi label="Recebido no período" valor={brl(d.recebido_periodo)} sub="Dinheiro que entrou" tom="verde" />
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Assinantes</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Empresas cadastradas" valor={d.empresas.total} sub={`${d.empresas.novas_periodo} novas no período`} />
              <Kpi label="Assinaturas ativas" valor={d.assinaturas.ativas} sub={`${d.assinaturas.em_teste} em teste`} />
              <Kpi label="Cancelamentos" valor={d.cancelamentos_periodo} sub={`Churn: ${pct(d.churn_percentual)}`} />
              <Kpi label="Usuários" valor={d.usuarios} />
            </div>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Cobrança</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Pagamentos pendentes" valor={brl(d.pendente.valor)} sub={`${d.pendente.qtd} fatura(s) a vencer`} />
              <Kpi label="Pagamentos atrasados" valor={brl(d.atrasado.valor)} sub={`${d.atrasado.qtd} fatura(s)`} tom={d.atrasado.qtd ? "vermelho" : undefined} />
              <Kpi label="Inadimplência" valor={pct(d.inadimplencia_percentual)} />
              <Kpi label="Empresas por status" valor={<span className="text-base">{d.empresas.ativa} ativas · {d.empresas.teste} teste</span>}
                sub={`${d.empresas.suspensa} suspensas · ${d.empresas.cancelada} canceladas`} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle>Faturamento por mês (12 meses)</CardTitle>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.evolucao.map((x) => ({ ...x, rotulo: MESES[Number(x.mes.slice(5)) - 1] }))} barGap={2}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={70} tickFormatter={(v) => brl(v).replace(",00", "")} />
                    <Tooltip formatter={(v) => brl(Number(v))} cursor={{ fill: "rgba(148,163,184,.12)" }} />
                    <Legend iconType="circle" />
                    <Bar dataKey="faturado" name="Faturado" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="recebido" name="Recebido" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {d.evolucao.every((x) => !x.faturado && !x.recebido) && (
                <p className="mt-2 text-xs text-slate-500">Ainda não há faturas. Os valores aparecem quando a cobrança estiver integrada a um gateway.</p>
              )}
            </Card>
            <Card>
              <CardTitle>Assinaturas por plano</CardTitle>
              <Table head={["Plano", "Ativas", "Teste", "MRR"]}>
                {d.por_plano.map((x) => (
                  <tr key={x.plano}><Td className="font-medium">{x.plano}</Td><Td className="tnum">{x.ativas}</Td><Td className="tnum">{x.teste}</Td><Td className="tnum">{brl(x.mrr)}</Td></tr>
                ))}
              </Table>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
