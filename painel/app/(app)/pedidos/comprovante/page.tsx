"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useApp } from "@/components/shell";
import { sb, q, urlTemporaria } from "@/lib/supabase";
import { useParam } from "@/lib/hooks";
import { brl, num, data, erroMsg, STATUS_PAGAMENTO } from "@/lib/utils";
import { Button, Loading, ErrorBox } from "@/components/ui";

type Dados = {
  p: { numero: number; descricao: string | null; valor_total: number; valor_pago: number; status_pagamento: string; data_entrega: string | null; created_at: string; forma_pagamento: string | null; clientes: { nome: string; documento: string | null } | null };
  itens: { descricao: string; quantidade: number; valor_unitario: number }[];
  pags: { valor: number; data: string; forma: string | null }[];
  e: { nome: string; documento: string | null; whatsapp: string | null; email: string | null; cidade: string | null; uf: string | null };
  logo: string | null;
};

/** Comprovante do pedido (recibo dos valores recebidos) — não é nota fiscal */
export default function Comprovante() {
  const app = useApp();
  const id = useParam("id");
  const [d, setD] = useState<Dados | null>(null);
  const [falha, setFalha] = useState("");
  useEffect(() => {
    if (!id) return;
    (async () => {
      const [p, itens, pags, e] = await Promise.all([
        q<Dados["p"]>(sb().from("pedidos").select("numero,descricao,valor_total,valor_pago,status_pagamento,data_entrega,created_at,forma_pagamento,clientes(nome,documento)").eq("id", id).single()),
        q<Dados["itens"]>(sb().from("pedido_itens").select("descricao,quantidade,valor_unitario").eq("pedido_id", id).order("created_at")),
        q<Dados["pags"]>(sb().from("pagamentos").select("valor,data,forma").eq("pedido_id", id).eq("estornado", false).order("data")),
        q<Dados["e"]>(sb().from("empresas").select("nome,documento,whatsapp,email,cidade,uf").eq("id", app.empresa.id).single()),
      ]);
      const logo = app.config.logo_path ? await urlTemporaria(app.config.logo_path).catch(() => null) : null;
      setD({ p, itens, pags, e, logo });
    })().catch((x) => setFalha(erroMsg(x)));
  }, [id, app.empresa.id, app.config.logo_path]);
  if (falha) return <ErrorBox erro={falha} />;
  if (!d) return <Loading />;
  const { p, e } = d;
  return (
    <>
      <div className="mb-4 flex justify-end print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / salvar em PDF</Button></div>
      <article className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-slate-900 print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">{d.logo && <img src={d.logo} alt="" className="h-12 w-12 object-contain" />}
            <div><div className="text-lg font-semibold">{e.nome}</div><div className="text-xs text-slate-500">{[e.documento, [e.cidade, e.uf].filter(Boolean).join("/"), e.whatsapp, e.email].filter(Boolean).join(" · ")}</div></div></div>
          <div className="text-right"><div className="text-xs uppercase text-slate-500">Comprovante de pedido</div><div className="text-xl font-semibold">{app.config.prefixo_pedido}-{p.numero}</div><div className="text-xs text-slate-500">{data(p.created_at)}</div></div>
        </header>
        <div className="grid gap-3 py-4 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-slate-500">Cliente</div><div className="font-medium">{p.clientes?.nome || "—"}</div>{p.clientes?.documento && <div className="text-xs">{p.clientes.documento}</div>}</div>
          <div><div className="text-xs text-slate-500">Entrega prevista</div><div className="font-medium">{data(p.data_entrega)}</div></div>
          <div><div className="text-xs text-slate-500">Pagamento</div><div className="font-medium">{STATUS_PAGAMENTO[p.status_pagamento]}</div></div>
        </div>
        {p.descricao && <p className="mb-3 text-sm">{p.descricao}</p>}
        {d.itens.length > 0 && <table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.itens.map((i, k) => <tr key={k}><td className="py-2">{i.descricao}</td><td className="text-right tnum">{num(i.quantidade)}</td><td className="text-right tnum">{brl(i.valor_unitario)}</td><td className="text-right tnum">{brl(i.quantidade * i.valor_unitario)}</td></tr>)}</tbody></table>}
        <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
          <div className="flex justify-between font-semibold"><span>Total do pedido</span><span className="tnum">{brl(p.valor_total)}</span></div>
          {d.pags.map((g, k) => <div key={k} className="flex justify-between text-slate-600"><span>Recebido {data(g.data)}{g.forma && ` (${g.forma})`}</span><span className="tnum">{brl(g.valor)}</span></div>)}
          <div className="flex justify-between border-t pt-1 font-semibold"><span>Saldo</span><span className="tnum">{brl(Math.max(p.valor_total - p.valor_pago, 0))}</span></div>
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">Documento sem valor fiscal.</p>
      </article>
    </>
  );
}
