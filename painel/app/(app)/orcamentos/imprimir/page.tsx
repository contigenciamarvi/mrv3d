"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useApp } from "@/components/shell";
import { sb, q, urlTemporaria } from "@/lib/supabase";
import { useParam } from "@/lib/hooks";
import { Button, Loading, ErrorBox } from "@/components/ui";
import { DocumentoOrcamento, type DocOrcamento } from "@/components/documento-orcamento";
import { erroMsg } from "@/lib/utils";

export default function Imprimir() {
  const app = useApp();
  const id = useParam("id");
  const [doc, setDoc] = useState<DocOrcamento | null>(null);
  const [falha, setFalha] = useState("");
  useEffect(() => {
    if (!id) return;
    (async () => {
      const o = await q<Record<string, never>>(sb().from("orcamentos").select("*, clientes(nome)").eq("id", id).single());
      const itens = await q<Record<string, never>[]>(sb().from("orcamento_itens").select("descricao,cor,quantidade,preco_unitario,preco_total,materiais(nome)").eq("orcamento_id", id).order("ordem"));
      const e = await q<Record<string, string | null>>(sb().from("empresas").select("nome,whatsapp,email,cidade,uf,documento,endereco").eq("id", app.empresa.id).single());
      const logo = app.config.logo_path ? await urlTemporaria(app.config.logo_path).catch(() => null) : null;
      setDoc({
        empresa: e as DocOrcamento["empresa"], logo,
        orcamento: { numero: `${app.config.prefixo_orcamento}-${o.numero}`, titulo: o.titulo, descricao: o.descricao, validade: o.validade, prazo_entrega_dias: o.prazo_entrega_dias,
          subtotal: o.subtotal, desconto: o.desconto_valor, frete: o.frete_cobrado, total: o.total, observacoes: o.observacoes, condicoes: o.condicoes,
          cliente: (o.clientes as unknown as { nome: string } | null)?.nome, revisao: o.revisao, emitido: o.enviado_em || o.created_at },
        itens: itens.map((i) => ({ descricao: i.descricao, cor: i.cor, material: (i.materiais as unknown as { nome: string } | null)?.nome, quantidade: i.quantidade, preco_unitario: i.preco_unitario, preco_total: i.preco_total })),
      });
    })().catch((e) => setFalha(erroMsg(e)));
  }, [id, app.empresa.id, app.config]);
  if (falha) return <ErrorBox erro={falha} />;
  if (!doc) return <Loading />;
  return (
    <>
      <div className="mb-4 flex justify-end gap-2 print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / salvar em PDF</Button></div>
      <div className="rounded-xl border border-slate-200 shadow-sm print:border-0 print:shadow-none"><DocumentoOrcamento d={doc} /></div>
    </>
  );
}
