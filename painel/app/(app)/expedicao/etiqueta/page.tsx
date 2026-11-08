"use client";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useApp } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useParam } from "@/lib/hooks";
import { num, data, erroMsg, MODALIDADES_ENVIO } from "@/lib/utils";
import { Button, Loading, ErrorBox } from "@/components/ui";

type E = { numero: number; modalidade: string; destinatario: string | null; telefone: string | null; endereco: string | null; cidade: string | null; uf: string | null; cep: string | null;
  peso_g: number | null; altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null; volumes: number; transportadora: string | null; servico: string | null;
  codigo_rastreio: string | null; observacoes: string | null; pedidos: { numero: number; descricao: string | null } | null };
type Emp = { nome: string; endereco: string | null; cidade: string | null; uf: string | null; cep: string | null; telefone: string | null; whatsapp: string | null };

/** Etiqueta de envio (10 × 15 cm) — impressão pelo navegador. Não substitui a etiqueta oficial dos Correios. */
export default function Etiqueta() {
  const app = useApp();
  const id = useParam("id");
  const [d, setD] = useState<{ e: E; emp: Emp } | null>(null);
  const [falha, setFalha] = useState("");
  useEffect(() => {
    if (!id) return;
    Promise.all([
      q<E>(sb().from("envios").select("numero,modalidade,destinatario,telefone,endereco,cidade,uf,cep,peso_g,altura_cm,largura_cm,comprimento_cm,volumes,transportadora,servico,codigo_rastreio,observacoes,pedidos(numero,descricao)").eq("id", id).single()),
      q<Emp>(sb().from("empresas").select("nome,endereco,cidade,uf,cep,telefone,whatsapp").eq("id", app.empresa.id).single()),
    ]).then(([e, emp]) => setD({ e, emp })).catch((x) => setFalha(erroMsg(x)));
  }, [id, app.empresa.id]);
  if (falha) return <ErrorBox erro={falha} />;
  if (!d) return <Loading />;
  const { e, emp } = d;
  return (
    <div>
      <style>{`@media print { @page { size: 100mm 150mm; margin: 4mm; } }`}</style>
      <div className="mb-4 flex justify-end gap-2 print:hidden"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir etiqueta{e.volumes > 1 ? `s (${e.volumes})` : ""}</Button></div>
      {Array.from({ length: Math.max(1, e.volumes) }).map((_, v) => (
        <div key={v} className="mx-auto mb-6 w-[100mm] break-after-page border-2 border-black bg-white p-3 font-sans text-[11pt] leading-snug text-black print:mb-0">
          <div className="flex items-start justify-between border-b-2 border-black pb-2">
            <div className="text-lg font-bold">{e.transportadora || MODALIDADES_ENVIO[e.modalidade]}{e.servico ? ` · ${e.servico}` : ""}</div>
            <div className="text-right text-xs">Envio #{e.numero}<br />Pedido #{e.pedidos?.numero}{e.volumes > 1 && <><br />Volume {v + 1}/{e.volumes}</>}</div>
          </div>
          {e.codigo_rastreio && <div className="border-b-2 border-black py-2 text-center"><div className="text-xs uppercase">Rastreio</div><div className="font-mono text-xl font-bold tracking-widest">{e.codigo_rastreio}</div></div>}
          <div className="border-b-2 border-black py-2">
            <div className="text-xs font-bold uppercase">Destinatário</div>
            <div className="text-base font-bold">{e.destinatario}</div>
            <div>{e.endereco}</div>
            <div>{e.cidade}{e.uf ? ` / ${e.uf}` : ""}</div>
            <div className="text-lg font-bold">CEP {e.cep || "________"}</div>
            {e.telefone && <div className="text-xs">Tel. {e.telefone}</div>}
          </div>
          <div className="border-b-2 border-black py-2 text-xs">
            <div className="font-bold uppercase">Remetente</div>
            <div className="font-semibold">{emp.nome}</div>
            <div>{emp.endereco}</div><div>{emp.cidade}{emp.uf ? ` / ${emp.uf}` : ""} {emp.cep ? `· CEP ${emp.cep}` : ""}</div>
            {(emp.telefone || emp.whatsapp) && <div>Tel. {emp.telefone || emp.whatsapp}</div>}
          </div>
          <div className="flex justify-between pt-2 text-xs">
            <span>{e.peso_g ? `${num(e.peso_g / 1000, 3)} kg` : ""}{e.altura_cm ? ` · ${num(e.altura_cm, 1)}×${num(e.largura_cm, 1)}×${num(e.comprimento_cm, 1)} cm` : ""}</span>
            <span>{data(new Date().toISOString())}</span>
          </div>
          {e.observacoes && <div className="mt-1 text-xs">Obs.: {e.observacoes}</div>}
        </div>))}
      <p className="text-center text-xs text-slate-500 print:hidden">Etiqueta de identificação. Para Correios/Melhor Envio, use também a etiqueta oficial com código de barras gerada no site deles.</p>
    </div>
  );
}
