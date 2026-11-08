"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sb, rpc } from "@/lib/supabase";
import { erroMsg } from "@/lib/utils";
import { Button, Field, Input, ErrorBox } from "@/components/ui";
import { TelaCentral } from "@/components/marca";

export default function CriarEmpresa() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [whats, setWhats] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => { sb().auth.getSession().then(({ data }) => { if (!data.session) router.replace("/login/"); }); }, [router]);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(""); setCarregando(true);
    try {
      const id = await rpc<string>("criar_empresa", { p_nome: nome, p_whatsapp: whats || null });
      try { localStorage.setItem("empresa", id); } catch {}
      router.replace("/onboarding/");
    } catch (e2) { setErro(erroMsg(e2)); setCarregando(false); }
  };
  return (
    <TelaCentral sub="Vamos criar sua empresa">
      <form onSubmit={criar} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">Você ganha um período de teste grátis. Depois dá para completar os dados no assistente.</p>
        {erro && <ErrorBox erro={erro} />}
        <Field label="Nome da empresa"><Input required maxLength={200} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Studio 3D Maker" /></Field>
        <Field label="WhatsApp (opcional)"><Input inputMode="tel" value={whats} onChange={(e) => setWhats(e.target.value)} placeholder="(11) 99999-0000" /></Field>
        <Button type="submit" loading={carregando} className="w-full">Criar empresa</Button>
        <button type="button" onClick={() => sb().auth.signOut().then(() => router.replace("/login/"))} className="w-full text-center text-sm text-slate-500 hover:underline">Sair</button>
      </form>
    </TelaCentral>
  );
}
