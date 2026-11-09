"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { sb } from "@/lib/supabase";
import { erroMsg } from "@/lib/utils";
import { Button, Field, Input, ErrorBox, Aviso } from "@/components/ui";
import { TelaCentral } from "@/components/marca";

type Modo = "entrar" | "criar" | "esqueci" | "nova-senha";

export default function Login() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [info, setInfo] = useState("");
  const [ver, setVer] = useState(false);

  useEffect(() => {
    // link de recuperação de senha volta para cá com #type=recovery
    if (window.location.hash.includes("type=recovery")) setModo("nova-senha");
    const { data } = sb().auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") setModo("nova-senha"); });
    sb().auth.getSession().then(({ data: s }) => { if (s.session && !window.location.hash.includes("type=recovery")) router.replace("/dashboard/"); });
    return () => data.subscription.unsubscribe();
  }, [router]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault(); setErro(""); setInfo(""); setCarregando(true);
    try {
      if (modo === "entrar") {
        const { error } = await sb().auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        router.replace("/dashboard/");
      } else if (modo === "criar") {
        if (senha.length < 8) throw new Error("Use uma senha com pelo menos 8 caracteres");
        if (senha !== senha2) throw new Error("As senhas não conferem");
        const { data, error } = await sb().auth.signUp({ email, password: senha, options: { emailRedirectTo: `${location.origin}/login/` } });
        if (error) throw error;
        if (data.session) router.replace("/criar-empresa/");
        else setInfo("Conta criada! Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, é só entrar.");
      } else if (modo === "esqueci") {
        const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/login/` });
        if (error) throw error;
        setInfo("Se existir uma conta com esse e-mail, você vai receber um link para criar uma nova senha.");
      } else {
        if (senha.length < 8) throw new Error("Use uma senha com pelo menos 8 caracteres");
        if (senha !== senha2) throw new Error("As senhas não conferem");
        const { error } = await sb().auth.updateUser({ password: senha });
        if (error) throw error;
        history.replaceState(null, "", "/login/");
        router.replace("/dashboard/");
      }
    } catch (e2) { setErro(erroMsg(e2)); } finally { setCarregando(false); }
  };

  const titulos: Record<Modo, string> = { entrar: "Entrar", criar: "Criar conta", esqueci: "Recuperar senha", "nova-senha": "Criar nova senha" };
  const subtitulos: Record<Modo, string> = { entrar: "Bem-vindo de volta! Acesse o painel da sua empresa.", criar: "Teste grátis, sem cartão de crédito.",
    esqueci: "Enviamos um link para você criar uma nova senha.", "nova-senha": "Escolha uma senha com pelo menos 8 caracteres." };
  const trocar = (m: Modo) => { setModo(m); setErro(""); setInfo(""); setSenha(""); setSenha2(""); };
  return (
    <TelaCentral>
      <form onSubmit={enviar} className="space-y-4">
        <div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">{titulos[modo]}</h1><p className="mt-1 text-sm text-slate-500">{subtitulos[modo]}</p></div>
        {erro && <ErrorBox erro={erro} />}
        {info && <Aviso tom="verde">{info}</Aviso>}
        {modo !== "nova-senha" && <Field label="E-mail"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        {modo !== "esqueci" && (
          <Field label={modo === "entrar" ? "Senha" : "Nova senha"}>
            <div className="relative">
              <Input type={ver ? "text" : "password"} required autoComplete={modo === "entrar" ? "current-password" : "new-password"} value={senha} onChange={(e) => setSenha(e.target.value)} className="pr-10" />
              <button type="button" onClick={() => setVer(!ver)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600" aria-label={ver ? "Esconder senha" : "Mostrar senha"} title={ver ? "Esconder senha" : "Mostrar senha"}>
                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
          </Field>
        )}
        {(modo === "criar" || modo === "nova-senha") && (
          <Field label="Repita a senha"><Input type={ver ? "text" : "password"} required autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} /></Field>
        )}
        {modo === "entrar" && <div className="-mt-2 text-right text-sm"><button type="button" className="text-slate-500 hover:text-brand-700 hover:underline" onClick={() => trocar("esqueci")}>Esqueci a senha</button></div>}
        <Button type="submit" loading={carregando} className="h-11 w-full text-base">{modo === "esqueci" ? "Enviar link" : titulos[modo]}</Button>
        {modo === "entrar" ? (
          <>
            <div className="relative py-2 text-center text-xs text-slate-400"><span className="absolute inset-x-0 top-1/2 border-t border-slate-200" /><span className="relative bg-white px-3">Ainda não usa o MRV 3D?</span></div>
            <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => trocar("criar")}>Criar conta grátis</Button>
          </>
        ) : (
          <div className="text-center text-sm"><button type="button" className="text-brand-700 hover:underline" onClick={() => trocar("entrar")}>Voltar para entrar</button></div>
        )}
      </form>
    </TelaCentral>
  );
}
