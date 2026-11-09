"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, MessageCircle, FileText, Truck } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { brl, data, dataHora, erroMsg, linkWhats, num, STATUS_PORTAL, STATUS_ENVIO, STATUS_PRODUCAO, STATUS_PAGAMENTO, cn } from "@/lib/utils";
import { Button, Loading, ErrorBox, Aviso } from "@/components/ui";

type Acomp = {
  loja: { nome: string; whatsapp: string | null; slug: string | null };
  solicitacao: { numero: number; status: string; criada_em: string; nome: string; quantidade: number; cor: string | null; observacoes: string | null; motivo_recusa: string | null; produto: string | null; material: string | null; arquivos: string[] };
  orcamento: { numero: number; status: string; total: number; validade: string | null; prazo_entrega_dias: number | null; token: string | null } | null;
  pedido: { numero: number; status: string; status_producao: string; status_pagamento: string; status_entrega: string; data_entrega: string | null; valor_total: number; valor_pago: number;
    transportadora: string | null; codigo_rastreio: string | null; entregue_em: string | null } | null;
  envio: { status: string; modalidade: string; codigo_rastreio: string | null; transportadora: string | null; data_postagem: string | null; previsao_entrega: string | null; entregue_em: string | null } | null;
};

/** Acompanhamento do comprador por link secreto: /acompanhar/?t=token */
export default function Acompanhar() {
  const [d, setD] = useState<Acomp | null>(null);
  const [falha, setFalha] = useState("");
  const [novo, setNovo] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const t = p.get("t"); setNovo(p.get("novo") === "1");
    if (!t) { setFalha("Link incompleto"); return; }
    rpc<Acomp>("portal_acompanhar", { p_token: t }).then((x) => { setD(x); document.title = `Pedido · ${x.loja.nome}`; }).catch((e) => setFalha(erroMsg(e)));
  }, []);
  if (falha) return <div className="mx-auto max-w-lg p-6"><ErrorBox erro={falha} /></div>;
  if (!d) return <Loading />;
  const s = d.solicitacao, o = d.orcamento, p = d.pedido, e = d.envio;
  const recusada = s.status === "recusada";
  const entregue = p && ["entregue", "retirado"].includes(p.status_entrega);
  const etapas: { t: string; ok: boolean; sub?: string }[] = [
    { t: "Pedido de orçamento recebido", ok: true, sub: dataHora(s.criada_em) },
    { t: "Loja analisando", ok: s.status !== "nova" },
    { t: "Proposta enviada", ok: !!o, sub: o ? `${brl(o.total)}${o.validade ? ` · válida até ${data(o.validade)}` : ""}` : undefined },
    { t: "Proposta aprovada", ok: !!o && ["aprovado", "convertido"].includes(o.status) },
    { t: "Em produção", ok: !!p && p.status_producao !== "aguardando", sub: p ? STATUS_PRODUCAO[p.status_producao] : undefined },
    { t: "Pronto / enviado", ok: !!p && ["pronto", "enviado", "entregue", "retirado"].includes(p.status_entrega), sub: e ? STATUS_ENVIO[e.status] : undefined },
    { t: "Entregue", ok: !!entregue, sub: p?.entregue_em ? dataHora(p.entregue_em) : undefined },
  ];
  const whats = linkWhats(d.loja.whatsapp, `Olá! Sobre minha solicitação #${s.numero}${p ? ` (pedido #${p.numero})` : ""}.`);
  const rastreio = e?.codigo_rastreio || p?.codigo_rastreio;
  return (
    <div className="min-h-screen bg-slate-50 py-8 text-slate-900">
      <div className="mx-auto max-w-xl space-y-4 px-4">
        <div className="text-center"><div className="text-sm text-slate-500">{d.loja.nome}</div><h1 className="text-xl font-semibold">Solicitação #{s.numero}</h1></div>
        {novo && <Aviso tom="verde">Pedido enviado! Guarde este link (ou salve nos favoritos) para acompanhar a proposta e a entrega.</Aviso>}
        {recusada && <Aviso tom="vermelho">A loja não conseguiu atender este pedido{s.motivo_recusa ? `: ${s.motivo_recusa}` : "."}</Aviso>}
        {o?.status === "enviado" && o.token && <a href={`/orcamento/?t=${o.token}`} className="block"><Button className="w-full"><FileText className="h-4 w-4" /> Ver proposta e aprovar ({brl(o.total)})</Button></a>}
        {o && o.status !== "enviado" && o.token && <a href={`/orcamento/?t=${o.token}`} className="block text-center text-sm text-brand-700 underline">Ver a proposta</a>}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <ol className="space-y-3">{etapas.map((x, i) => (
            <li key={i} className="flex gap-3">{x.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
              <div><div className={cn("text-sm", x.ok ? "font-medium" : "text-slate-400")}>{x.t}</div>{x.sub && x.ok && <div className="text-xs text-slate-500">{x.sub}</div>}</div></li>))}</ol>
        </div>
        {p && <div className="space-y-1 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <div className="font-medium">Pedido #{p.numero}</div>
          <div>Pagamento: {STATUS_PAGAMENTO[p.status_pagamento]} ({brl(p.valor_pago)} de {brl(p.valor_total)})</div>
          {p.data_entrega && !entregue && <div>Previsão: {data(e?.previsao_entrega || p.data_entrega)}</div>}
          {rastreio && <div className="flex items-center gap-2"><Truck className="h-4 w-4" /> {e?.transportadora || p.transportadora}: <span className="font-mono font-semibold">{rastreio}</span></div>}
        </div>}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <div className="mb-1 font-medium">O que você pediu</div>
          <div>{num(s.quantidade)} × {s.produto || "Peça personalizada"}{s.material ? ` · ${s.material}` : ""}{s.cor ? ` · ${s.cor}` : ""}</div>
          {s.arquivos.length > 0 && <div className="text-slate-500">Arquivos: {s.arquivos.join(", ")}</div>}
          {s.observacoes && <p className="mt-1 whitespace-pre-line text-slate-600">{s.observacoes}</p>}
          <div className="mt-2 text-xs text-slate-400">Situação: {STATUS_PORTAL[s.status]}</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {whats && <a href={whats} target="_blank" rel="noreferrer"><Button variant="secondary"><MessageCircle className="h-4 w-4" /> Falar com a loja</Button></a>}
          {d.loja.slug && <a href={`/loja/?s=${d.loja.slug}`}><Button variant="ghost">Voltar à loja</Button></a>}
        </div>
      </div>
    </div>
  );
}
