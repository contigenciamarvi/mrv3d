"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";
import { Button, Field, Input, ErrorBox } from "@/components/ui";
import { Logo } from "@/components/logo";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(""); setCarregando(true);
    const { error } = await sb().auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) { setErro(/Invalid login/i.test(error.message) ? "E-mail ou senha incorretos" : error.message); return; }
    router.replace("/dashboard/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Logo claro />
          <span className="ml-auto rounded bg-brand-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">Super Admin</span>
        </div>
        {erro && <ErrorBox erro={erro} />}
        <Field label="E-mail"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Senha"><Input type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></Field>
        <Button type="submit" loading={carregando} className="w-full">Entrar</Button>
        <p className="text-center text-xs text-slate-500">Acesso exclusivo da equipe da plataforma.</p>
      </form>
    </div>
  );
}
