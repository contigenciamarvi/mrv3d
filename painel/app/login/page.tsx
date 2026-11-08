"use client";
import { useEffect, useState } from "react";
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
  return (
    <TelaCentral>
      <form onSubmit={enviar} className="space-y-4">
        <h1 className="text-lg font-semibold">{titulos[modo]}</h1>
        {erro && <ErrorBox erro={erro} />}
        {info && <Aviso tom="verde">{info}</Aviso>}
        {modo !== "nova-senha" && <Field label="E-mail"><Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        {modo !== "esqueci" && (
          <Field label={modo === "entrar" ? "Senha" : "Nova senha"}>
            <Input type="password" required autoComplete={modo === "entrar" ? "current-password" : "new-password"} value={senha} onChange={(e) => setSenha(e.target.value)} />
          </Field>
        )}
        {(modo === "criar" || modo === "nova-senha") && (
          <Field label="Repita a senha"><Input type="password" required autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} /></Field>
        )}
        <Button type="submit" loading={carregando} className="w-full">{modo === "esqueci" ? "Enviar link" : titulos[modo]}</Button>
        <div className="flex justify-between text-sm">
          {modo === "entrar" ? (
            <>
              <button type="button" className="text-brand-600 hover:underline" onClick={() => { setModo("criar"); setErro(""); setInfo(""); }}>Criar conta grátis</button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => { setModo("esqueci"); setErro(""); setInfo(""); }}>Esqueci a senha</button>
            </>
          ) : (
            <button type="button" className="text-brand-600 hover:underline" onClick={() => { setModo("entrar"); setErro(""); setInfo(""); }}>Voltar para entrar</button>
          )}
        </div>
      </form>
    </TelaCentral>
  );
}
