"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Printer } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { erroMsg, linkWhats } from "@/lib/utils";
import { Button, Field, Input, Textarea, Loading, ErrorBox, Aviso } from "@/components/ui";
import { DocumentoOrcamento, type DocOrcamento } from "@/components/documento-orcamento";

type Publico = {
  empresa: DocOrcamento["empresa"];
  orcamento: { numero: number; prefixo: string; titulo: string; descricao: string | null; status: string; expirado: boolean; validade: string; prazo_entrega_dias: number | null;
    subtotal: number; desconto: number; frete: number; total: number; observacoes: string | null; condicoes: string | null; revisao: number; enviado_em: string | null; cliente: string | null };
  itens: DocOrcamento["itens"];
};

export default function OrcamentoPublico() {
  const [token, setToken] = useState<string | null>(null);
  const [d, setD] = useState<Publico | null>(null);
  const [falha, setFalha] = useState("");
  const [modo, setModo] = useState<"aprovar" | "recusar" | null>(null);
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);

  const carregar = (t: string) => rpc<Publico>("orcamento_publico", { p_token: t }).then(setD).catch((e) => setFalha(erroMsg(e)));
  useEffect(() => { const t = new URLSearchParams(location.search).get("t"); setToken(t); if (t) { carregar(t); rpc("orcamento_visualizado", { p_token: t }).catch(() => undefined); } else setFalha("Link incompleto"); }, []);

  const responder = async (e: React.FormEvent) => {
    e.preventDefault(); if (!token || !modo) return; setEnviando(true);
    try { const r = await rpc<string>("responder_orcamento_publico", { p_token: token, p_aprovar: modo === "aprovar", p_nome: nome, p_motivo: motivo || null }); setResposta(r); setModo(null); carregar(token); }
    catch (e2) { setFalha(erroMsg(e2)); } finally { setEnviando(false); }
  };

  if (falha && !d) return <div className="mx-auto max-w-lg p-6"><ErrorBox erro={falha} /></div>;
  if (!d) return <Loading />;
  const o = d.orcamento;
  const podeResponder = o.status === "enviado" && !o.expirado;
  const whats = linkWhats(d.empresa.whatsapp, `Olá! Sobre o orçamento ${o.prefixo}-${o.numero} (${o.titulo})`);
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl space-y-4 px-3">
        {resposta === "aprovado" && <Aviso tom="verde">Obrigado! Seu orçamento foi <b>aprovado</b>. A {d.empresa.nome} vai entrar em contato para os próximos passos.</Aviso>}
        {resposta === "rejeitado" && <Aviso>Recebemos sua resposta. Obrigado pelo retorno!</Aviso>}
        {!resposta && o.status === "aprovado" && <Aviso tom="verde">Este orçamento já foi aprovado.</Aviso>}
        {!resposta && o.status === "convertido" && <Aviso tom="verde">Orçamento aprovado e pedido em andamento.</Aviso>}
        {!resposta && o.status === "rejeitado" && <Aviso>Este orçamento foi recusado. Fale com a empresa se quiser rever.</Aviso>}
        {o.expirado && <Aviso tom="amarelo">Este orçamento venceu. Peça uma versão atualizada à empresa.</Aviso>}
        {falha && <ErrorBox erro={falha} />}
        <div className="overflow-hidden rounded-xl shadow-sm print:shadow-none">
          <DocumentoOrcamento d={{ empresa: d.empresa, orcamento: { ...o, numero: `${o.prefixo}-${o.numero}`, emitido: o.enviado_em }, itens: d.itens }} />
        </div>
        {podeResponder && !modo && (
          <div className="flex flex-wrap justify-center gap-3 print:hidden">
            <Button onClick={() => setModo("aprovar")} className="bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Aprovar orçamento</Button>
            <Button variant="secondary" onClick={() => setModo("recusar")}><XCircle className="h-4 w-4" /> Recusar</Button>
          </div>
        )}
        {modo && (
          <form onSubmit={responder} className="space-y-3 rounded-xl bg-white p-5 shadow-sm print:hidden">
            <h2 className="font-semibold">{modo === "aprovar" ? "Confirmar aprovação" : "Recusar orçamento"}</h2>
            <Field label="Seu nome"><Input required minLength={2} autoFocus value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
            {modo === "recusar" && <Field label="Pode contar o motivo?"><Textarea required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>}
            {modo === "aprovar" && <p className="text-sm text-slate-600">Ao aprovar, você concorda com os itens, valores e condições acima.</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setModo(null)}>Voltar</Button><Button type="submit" loading={enviando}>{modo === "aprovar" ? "Aprovar" : "Enviar resposta"}</Button></div>
          </form>
        )}
        <div className="flex justify-center gap-4 text-sm print:hidden">
          {whats && <a href={whats} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Falar com a empresa no WhatsApp</a>}
          <button onClick={() => window.print()} className="flex items-center gap-1 text-slate-600 underline"><Printer className="h-3.5 w-3.5" /> Salvar PDF</button>
        </div>
      </div>
    </div>
  );
}
