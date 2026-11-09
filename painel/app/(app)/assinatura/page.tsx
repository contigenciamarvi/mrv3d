"use client";
import { useState } from "react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, data, dataHora, num, STATUS_ASSINATURA, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Select, Textarea, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Modal, Aviso } from "@/components/ui";

type Minha = {
  assinatura: { status: string; periodicidade: string; valor: number; desconto_percentual: number; inicio: string; teste_ate: string | null; proxima_cobranca: string | null; cancelada_em: string | null } | null;
  plano: { id: string; nome: string; preco_mensal: number; preco_anual: number; limite_impressoras: number; limite_usuarios: number; armazenamento_mb: number; recursos: string[] } | null;
  uso: { impressoras: number; usuarios: number; armazenamento_mb: number };
  pode_gerenciar: boolean;
  solicitacoes: { id: string; tipo: string; status: string; motivo: string | null; resposta: string | null; created_at: string; plano: string | null }[];
};
type Plano = { id: string; nome: string; descricao: string | null; preco_mensal: number; preco_anual: number; limite_impressoras: number; limite_usuarios: number; armazenamento_mb: number; ordem: number };
const TIPOS: Record<string, string> = { upgrade: "Upgrade", downgrade: "Downgrade", cancelamento: "Cancelamento", periodicidade: "Mudar periodicidade" };

function Barra({ usado, limite, rotulo }: { usado: number; limite: number; rotulo: string }) {
  const p = limite ? Math.min(100, (usado / limite) * 100) : 0;
  return (
    <div><div className="mb-1 flex justify-between text-sm"><span>{rotulo}</span><span className="tnum">{num(usado, 1)} / {num(limite, 0)}</span></div>
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-700"><div className={cn("h-2 rounded", p >= 90 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${p}%` }} /></div></div>
  );
}

export default function Assinatura() {
  const app = useApp();
  const [pedido, setPedido] = useState<{ tipo: string; plano: string; periodicidade: string; motivo: string } | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [m, planos, faturas] = await Promise.all([
      rpc<Minha>("minha_assinatura", { p_empresa: app.empresa.id }),
      q<Plano[]>(sb().from("planos").select("id,nome,descricao,preco_mensal,preco_anual,limite_impressoras,limite_usuarios,armazenamento_mb,ordem").eq("ativo", true).eq("descontinuado", false).order("ordem")),
      q<{ id: string; descricao: string | null; valor: number; vencimento: string; status: string; valor_pago: number | null; link_pagamento: string | null }[]>(
        sb().from("faturas").select("id,descricao,valor,vencimento,status,valor_pago,link_pagamento").eq("empresa_id", app.empresa.id).order("vencimento", { ascending: false }).limit(50)),
    ]);
    return { m, planos, faturas };
  }, [app.empresa.id]);
  if (falha) return <ErrorBox erro={falha} onRetry={recarregar} />;
  if (carregando || !dados) return <Loading />;
  const { m, planos, faturas } = dados;
  const a = m.assinatura, p = m.plano;
  const pendente = m.solicitacoes.find((s) => s.status === "pendente");
  const ordemAtual = planos.find((x) => x.id === p?.id)?.ordem ?? 0;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pedido) return;
    try {
      await rpc("solicitar_alteracao_assinatura", { p_empresa: app.empresa.id, p_tipo: pedido.tipo, p_plano: pedido.plano || null, p_periodicidade: pedido.tipo === "periodicidade" ? pedido.periodicidade : null, p_motivo: pedido.motivo || null });
      toast("Solicitação enviada. A equipe MRV 3D vai confirmar com você."); setPedido(null); recarregar();
    } catch (e2) { erro(e2); }
  };

  return (
    <>
      <PageHeader titulo="Minha Assinatura" />
      {!a || !p ? <Card><Empty texto="Nenhuma assinatura encontrada. Fale com o suporte." /></Card> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle right={<Badge tom={tomStatus(a.status)}>{STATUS_ASSINATURA[a.status]}</Badge>}>Plano {p.nome}</CardTitle>
            <div className="text-3xl font-semibold tnum">{brl(a.valor)}<span className="text-base font-normal text-slate-500">/{a.periodicidade === "anual" ? "ano" : "mês"}</span></div>
            {a.desconto_percentual > 0 && <div className="text-sm text-emerald-700">{num(a.desconto_percentual)}% de desconto aplicado</div>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Início</dt><dd>{data(a.inicio)}</dd></div>
              {a.status === "teste" ? <div><dt className="text-slate-500">Teste até</dt><dd className="font-medium">{data(a.teste_ate)}</dd></div>
                : <div><dt className="text-slate-500">Próxima cobrança</dt><dd>{data(a.proxima_cobranca)}</dd></div>}
            </dl>
            {a.status === "teste" && <div className="mt-4"><Aviso>Você está no período de teste. Para continuar depois de {data(a.teste_ate)}, a equipe vai enviar o link de pagamento.</Aviso></div>}
            {["atrasada", "pendente"].includes(a.status) && <div className="mt-4"><Aviso tom="vermelho">Há um pagamento pendente. Regularize para evitar a suspensão.</Aviso></div>}
          </Card>
          <Card>
            <CardTitle>Uso do plano</CardTitle>
            <div className="space-y-4">
              <Barra rotulo="Impressoras ativas" usado={m.uso.impressoras} limite={p.limite_impressoras} />
              <Barra rotulo="Usuários" usado={m.uso.usuarios} limite={p.limite_usuarios} />
              <Barra rotulo="Armazenamento (MB)" usado={m.uso.armazenamento_mb} limite={p.armazenamento_mb} />
            </div>
          </Card>
        </div>
      )}

      {m.pode_gerenciar && (
        <Card className="mt-6">
          <CardTitle>Planos disponíveis</CardTitle>
          {pendente && <div className="mb-4"><Aviso tom="amarelo">Solicitação de {TIPOS[pendente.tipo].toLowerCase()} {pendente.plano ? `para ${pendente.plano} ` : ""}aguardando a equipe MRV 3D.{" "}
            <button className="underline" onClick={async () => { try { await rpc("cancelar_solicitacao_assinatura", { p_id: pendente.id }); toast("Solicitação cancelada"); recarregar(); } catch (e) { erro(e); } }}>Cancelar solicitação</button></Aviso></div>}
          <div className="grid gap-4 md:grid-cols-3">
            {planos.map((pl) => {
              const atual = pl.id === p?.id;
              return (
                <div key={pl.id} className={cn("rounded-xl border p-4", atual ? "border-brand-600 ring-2 ring-brand-600/20" : "border-slate-200 dark:border-slate-700")}>
                  <div className="flex items-center justify-between"><span className="font-semibold">{pl.nome}</span>{atual && <Badge tom="azul">atual</Badge>}</div>
                  <div className="mt-1 text-2xl font-semibold tnum">{brl(pl.preco_mensal)}<span className="text-sm font-normal text-slate-500">/mês</span></div>
                  <div className="text-xs text-slate-500">ou {brl(pl.preco_anual)}/ano</div>
                  <ul className="mt-3 space-y-1 text-sm"><li>{pl.limite_impressoras} impressoras</li><li>{pl.limite_usuarios} usuário(s)</li><li>{num(pl.armazenamento_mb / 1024, 1)} GB de arquivos</li></ul>
                  {pl.descricao && <p className="mt-2 text-xs text-slate-500">{pl.descricao}</p>}
                  {!atual && <Button size="sm" className="mt-4 w-full" variant={pl.ordem > ordemAtual ? "primary" : "secondary"} disabled={!!pendente || !app.podeEscrever}
                    onClick={() => setPedido({ tipo: pl.ordem > ordemAtual ? "upgrade" : "downgrade", plano: pl.id, periodicidade: a?.periodicidade || "mensal", motivo: "" })}>
                    {pl.ordem > ordemAtual ? "Fazer upgrade" : "Solicitar downgrade"}</Button>}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <button disabled={!!pendente} className="text-brand-700 underline disabled:opacity-50" onClick={() => setPedido({ tipo: "periodicidade", plano: "", periodicidade: a?.periodicidade === "anual" ? "mensal" : "anual", motivo: "" })}>Mudar para cobrança {a?.periodicidade === "anual" ? "mensal" : "anual"}</button>
            <button disabled={!!pendente} className="text-red-600 underline disabled:opacity-50" onClick={() => setPedido({ tipo: "cancelamento", plano: "", periodicidade: "", motivo: "" })}>Cancelar assinatura</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Mudanças de plano são confirmadas pela equipe MRV 3D (o pagamento online ainda não está integrado). Nada muda na sua conta sem essa confirmação.</p>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardTitle>Faturas</CardTitle>
          {!faturas.length ? <Empty texto="Nenhuma fatura ainda" /> : <Table head={["Vencimento", "Descrição", "Valor", "Situação", ""]}>{faturas.map((f) => (
            <tr key={f.id}><Td>{data(f.vencimento)}</Td><Td>{f.descricao || "Assinatura"}</Td><Td className="tnum">{brl(f.valor)}</Td><Td><Badge tom={tomStatus(f.status)}>{f.status}</Badge></Td>
              <Td>{f.link_pagamento && f.status !== "paga" && <a href={f.link_pagamento} target="_blank" rel="noreferrer" className="text-sm text-brand-700 underline">Pagar</a>}</Td></tr>))}</Table>}
        </Card>
        {m.pode_gerenciar && <Card><CardTitle>Solicitações</CardTitle>
          {!m.solicitacoes.length ? <Empty texto="Nenhuma solicitação" /> : <Table head={["Quando", "Pedido", "Situação", "Resposta"]}>{m.solicitacoes.map((s) => (
            <tr key={s.id}><Td>{dataHora(s.created_at)}</Td><Td>{TIPOS[s.tipo]}{s.plano && ` → ${s.plano}`}</Td><Td><Badge tom={s.status === "atendida" ? "verde" : s.status === "pendente" ? "amarelo" : "cinza"}>{s.status}</Badge></Td><Td className="text-slate-500">{s.resposta || "—"}</Td></tr>))}</Table>}
        </Card>}
      </div>

      <Modal aberto={!!pedido} titulo={pedido ? TIPOS[pedido.tipo] : ""} onClose={() => setPedido(null)}>
        {pedido && <form className="space-y-3" onSubmit={enviar}>
          {["upgrade", "downgrade"].includes(pedido.tipo) && <Field label="Plano"><Select value={pedido.plano} onChange={(e) => setPedido({ ...pedido, plano: e.target.value })}>{planos.filter((x) => x.id !== p?.id).map((x) => <option key={x.id} value={x.id}>{x.nome} — {brl(x.preco_mensal)}/mês</option>)}</Select></Field>}
          {pedido.tipo === "downgrade" && <Aviso tom="amarelo">Confira se o uso atual (impressoras, usuários, arquivos) cabe no plano menor.</Aviso>}
          {pedido.tipo === "periodicidade" && <p className="text-sm">Mudar a cobrança para <b>{pedido.periodicidade}</b>.</p>}
          {pedido.tipo === "cancelamento" && <Aviso tom="vermelho">Após o cancelamento você continua consultando os dados, mas não poderá fazer alterações. Exporte seus dados em Configurações → Backup.</Aviso>}
          <Field label={pedido.tipo === "cancelamento" ? "Motivo do cancelamento" : "Observação (opcional)"}><Textarea required={pedido.tipo === "cancelamento"} value={pedido.motivo} onChange={(e) => setPedido({ ...pedido, motivo: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPedido(null)}>Voltar</Button><Button type="submit" variant={pedido.tipo === "cancelamento" ? "danger" : "primary"}>Enviar solicitação</Button></div>
        </form>}
      </Modal>
    </>
  );
}
