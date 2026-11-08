import { brl, num, data } from "@/lib/utils";

export type DocOrcamento = {
  empresa: { nome: string; whatsapp?: string | null; email?: string | null; cidade?: string | null; uf?: string | null; documento?: string | null; endereco?: string | null };
  logo?: string | null;
  orcamento: { numero: string; titulo: string; descricao?: string | null; validade?: string | null; prazo_entrega_dias?: number | null; subtotal: number; desconto: number; frete: number; total: number;
    observacoes?: string | null; condicoes?: string | null; cliente?: string | null; revisao?: number; emitido?: string | null };
  itens: { descricao: string; cor?: string | null; material?: string | null; quantidade: number; preco_unitario: number; preco_total: number }[];
};

export function DocumentoOrcamento({ d }: { d: DocOrcamento }) {
  const o = d.orcamento;
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-slate-900 print:p-0">
      <header className="flex items-start justify-between gap-6 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          {d.logo ? <img src={d.logo} alt="" className="h-14 w-14 rounded object-contain" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">{d.empresa.nome.slice(0, 2).toUpperCase()}</div>}
          <div><div className="text-lg font-semibold">{d.empresa.nome}</div>
            <div className="text-xs text-slate-500">{[d.empresa.documento, d.empresa.endereco, [d.empresa.cidade, d.empresa.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ")}</div>
            <div className="text-xs text-slate-500">{[d.empresa.whatsapp, d.empresa.email].filter(Boolean).join(" · ")}</div></div>
        </div>
        <div className="text-right"><div className="text-xs uppercase tracking-wide text-slate-500">Orçamento</div><div className="text-xl font-semibold">{o.numero}</div>
          {o.revisao ? <div className="text-xs text-slate-500">revisão {o.revisao}</div> : null}{o.emitido && <div className="text-xs text-slate-500">emitido em {data(o.emitido)}</div>}</div>
      </header>
      <section className="grid gap-4 py-5 text-sm sm:grid-cols-3">
        <div><div className="text-xs text-slate-500">Cliente</div><div className="font-medium">{o.cliente || "—"}</div></div>
        <div><div className="text-xs text-slate-500">Válido até</div><div className="font-medium">{data(o.validade)}</div></div>
        <div><div className="text-xs text-slate-500">Prazo de entrega</div><div className="font-medium">{o.prazo_entrega_dias != null ? `${o.prazo_entrega_dias} dia(s) após aprovação` : "—"}</div></div>
      </section>
      <h1 className="text-lg font-semibold">{o.titulo}</h1>
      {o.descricao && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{o.descricao}</p>}
      <table className="mt-4 w-full text-sm">
        <thead><tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500"><th className="py-2">Item</th><th className="py-2 text-right">Qtd</th><th className="py-2 text-right">Unitário</th><th className="py-2 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {d.itens.map((i, k) => (
            <tr key={k}><td className="py-2"><div className="font-medium">{i.descricao}</div>{(i.material || i.cor) && <div className="text-xs text-slate-500">{[i.material, i.cor].filter(Boolean).join(" · ")}</div>}</td>
              <td className="py-2 text-right tnum">{num(i.quantidade)}</td><td className="py-2 text-right tnum">{brl(i.preco_unitario)}</td><td className="py-2 text-right tnum">{brl(i.preco_total)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span className="tnum">{brl(o.subtotal)}</span></div>
        {o.desconto > 0 && <div className="flex justify-between"><span>Desconto</span><span className="tnum">− {brl(o.desconto)}</span></div>}
        {o.frete > 0 && <div className="flex justify-between"><span>Frete</span><span className="tnum">{brl(o.frete)}</span></div>}
        <div className="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold"><span>Total</span><span className="tnum">{brl(o.total)}</span></div>
      </div>
      {(o.observacoes || o.condicoes) && (
        <section className="mt-6 space-y-3 text-sm">
          {o.condicoes && <div><div className="text-xs font-semibold uppercase text-slate-500">Condições</div><p className="whitespace-pre-wrap">{o.condicoes}</p></div>}
          {o.observacoes && <div><div className="text-xs font-semibold uppercase text-slate-500">Observações</div><p className="whitespace-pre-wrap">{o.observacoes}</p></div>}
        </section>
      )}
    </article>
  );
}
