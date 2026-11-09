"use client";
import Link from "next/link";
import { Printer, Cloud, Truck, Mail, CreditCard, MessageCircle } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { dataHora } from "@/lib/utils";
import { Card, Badge, Button } from "@/components/ui";

type Integ = { provedor: string; status: string; modo: string; ultima_sincronizacao: string | null };

export default function Integracoes() {
  const app = useApp();
  const { dados } = useDados(async () => {
    const [ints, ags] = await Promise.all([
      q<Integ[]>(sb().from("integracoes").select("provedor,status,modo,ultima_sincronizacao").eq("empresa_id", app.empresa.id)),
      app.pode("integracoes_config") || app.pode("impressoras_ver") ? q<{ id: string; ultimo_contato: string | null }[]>(sb().from("agentes_locais").select("id,ultimo_contato").eq("empresa_id", app.empresa.id).eq("ativo", true)) : Promise.resolve([]),
    ]);
    return { ints, ags };
  }, [app.empresa.id]);
  const bambu = dados?.ints.find((i) => i.provedor === "bambu_lab");
  const online = (dados?.ags || []).filter((a) => a.ultimo_contato && Date.now() - new Date(a.ultimo_contato).getTime() < 300000).length;
  const cards: { nome: string; desc: string; icone: typeof Printer; status: [string, "verde" | "amarelo" | "cinza"]; href?: string; detalhe?: string }[] = [
    { nome: "Bambu Lab e projetos 3D", desc: "Biblioteca de projetos (.gcode.3mf, 3MF, STL), referências do MakerWorld e monitoramento pela rede local.", icone: Printer, href: "/integracoes/bambu/",
      status: bambu?.status === "conectada" ? ["Conectada (rede local)", "verde"] : ["Biblioteca ativa · conexão não configurada", "amarelo"], detalhe: bambu?.ultima_sincronizacao ? `Última leitura ${dataHora(bambu.ultima_sincronizacao)}` : undefined },
    { nome: "Agente local de impressoras", desc: "Klipper/Moonraker, OctoPrint e Bambu Lab pela rede da loja, somente leitura.", icone: Cloud, href: "/integracoes/bambu/?aba=config",
      status: dados?.ags.length ? [`${online}/${dados.ags.length} agente(s) online`, online ? "verde" : "amarelo"] : ["Não configurada", "cinza"] },
    { nome: "Melhor Envio", desc: "Cotação de frete e etiquetas.", icone: Truck, status: ["Não configurada", "cinza"] },
    { nome: "E-mail (SMTP)", desc: "Envio de orçamentos e avisos por e-mail.", icone: Mail, status: ["Não configurada", "cinza"] },
    { nome: "Gateway de pagamento", desc: "Pix e cartão com confirmação automática.", icone: CreditCard, status: ["Não configurada", "cinza"] },
    { nome: "WhatsApp oficial", desc: "Hoje o envio é por link wa.me (sem confirmação de entrega).", icone: MessageCircle, status: ["Não configurada", "cinza"] },
  ];
  return (
    <>
      <PageHeader titulo="Integrações" sub="Integrações sem credenciais aparecem como “Não configurada” — nunca como funcionando" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map((c) => (
        <Card key={c.nome} className="flex flex-col gap-3">
          <div className="flex items-start gap-3"><c.icone className="h-6 w-6 shrink-0 text-brand-700" /><div><div className="font-semibold">{c.nome}</div><p className="text-sm text-slate-500">{c.desc}</p></div></div>
          <div className="mt-auto flex items-center justify-between gap-2"><div><Badge tom={c.status[1]}>{c.status[0]}</Badge>{c.detalhe && <div className="mt-1 text-xs text-slate-500">{c.detalhe}</div>}</div>
            {c.href ? <Link href={c.href}><Button size="sm" variant="secondary">Abrir</Button></Link> : <span className="text-xs text-slate-400">Em breve</span>}</div>
        </Card>))}</div>
    </>
  );
}
