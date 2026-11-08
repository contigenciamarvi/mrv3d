"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Building2, Users, Layers, Receipt, ShieldCheck, Wallet, BarChart3, Gauge, LifeBuoy,
  Bell, Plug, Settings, PanelLeftClose, PanelLeftOpen, Moon, Sun, LogOut, Search, Loader2, Lock,
} from "lucide-react";
import { sb, rpc } from "@/lib/supabase";
import { cn, PAPEIS } from "@/lib/utils";
import type { Toast } from "@/lib/toast";

type Sessao = { email: string; userId: string; papel: string };
const Ctx = createContext<Sessao | null>(null);
export const useSessao = () => useContext(Ctx)!;

const MENU: { href: string; label: string; icon: typeof LayoutDashboard; pronto: boolean; papeis?: string[] }[] = [
  { href: "/dashboard/", label: "Dashboard", icon: LayoutDashboard, pronto: true },
  { href: "/empresas/", label: "Empresas", icon: Building2, pronto: true },
  { href: "/usuarios/", label: "Usuários", icon: Users, pronto: true, papeis: ["proprietario", "administrador", "suporte", "atendimento"] },
  { href: "/planos/", label: "Planos e Assinaturas", icon: Layers, pronto: true },
  { href: "/cobrancas/", label: "Cobranças", icon: Receipt, pronto: true, papeis: ["proprietario", "administrador", "financeiro", "suporte"] },
  { href: "#", label: "Financeiro SaaS", icon: Wallet, pronto: false },
  { href: "#", label: "Relatórios", icon: BarChart3, pronto: false },
  { href: "/uso/", label: "Uso da Plataforma", icon: Gauge, pronto: true },
  { href: "#", label: "Suporte", icon: LifeBuoy, pronto: false },
  { href: "#", label: "Notificações", icon: Bell, pronto: false },
  { href: "#", label: "Integrações", icon: Plug, pronto: false },
  { href: "/auditoria/", label: "Auditoria e Segurança", icon: ShieldCheck, pronto: true, papeis: ["proprietario", "administrador"] },
  { href: "#", label: "Configurações", icon: Settings, pronto: false },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "negado">("carregando");
  const [recolhido, setRecolhido] = useState(false);
  const [escuro, setEscuro] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem("menu-recolhido") === "1");
      const d = localStorage.getItem("tema") === "escuro";
      setEscuro(d); document.documentElement.classList.toggle("dark", d);
    } catch {}
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setToasts((x) => [...x, t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 4000);
    };
    window.addEventListener("app-toast", onToast);

    const verificar = async () => {
      const { data } = await sb().auth.getSession();
      const u = data.session?.user;
      if (!u) { router.replace("/login/"); return; }
      try {
        const papel = await rpc<string | null>("meu_papel_plataforma");
        if (!papel) { setEstado("negado"); setSessao({ email: u.email || "", userId: u.id, papel: "" }); return; }
        setSessao({ email: u.email || "", userId: u.id, papel });
        setEstado("ok");
      } catch { setEstado("negado"); }
    };
    verificar();
    const { data: sub } = sb().auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") router.replace("/login/"); });
    return () => { window.removeEventListener("app-toast", onToast); sub.subscription.unsubscribe(); };
  }, [router]);

  const alternarTema = () => {
    const d = !escuro; setEscuro(d); document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("tema", d ? "escuro" : "claro"); } catch {}
  };
  const alternarMenu = () => {
    const r = !recolhido; setRecolhido(r);
    try { localStorage.setItem("menu-recolhido", r ? "1" : "0"); } catch {}
  };
  const sair = async () => { await sb().auth.signOut(); router.replace("/login/"); };

  if (estado === "carregando") {
    return <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Verificando acesso…</div>;
  }
  if (estado === "negado") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <Lock className="h-8 w-8 text-slate-400" />
        <h1 className="text-lg font-semibold">Acesso restrito à equipe da plataforma</h1>
        <p className="max-w-sm text-sm text-slate-500">A conta {sessao?.email} não faz parte da equipe do Super Admin.</p>
        <button onClick={sair} className="text-sm text-brand-600 underline">Sair e entrar com outra conta</button>
      </div>
    );
  }

  const itens = MENU.filter((m) => !m.papeis || m.papeis.includes(sessao!.papel));

  return (
    <Ctx.Provider value={sessao}>
      <div className="flex min-h-screen">
        <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-300 transition-all md:flex dark:border-slate-800", recolhido ? "w-16" : "w-64")}>
          <div className="flex h-14 items-center gap-2 px-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">M3</div>
            {!recolhido && <div className="leading-tight"><div className="text-sm font-semibold text-white">MRV3D Solutions</div><div className="text-[11px] text-slate-400">Super Admin</div></div>}
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            {itens.map((m) => {
              const ativo = m.pronto && path?.startsWith(m.href.replace(/\/$/, ""));
              const Icon = m.icon;
              const conteudo = (
                <>
                  <Icon className="h-4 w-4 shrink-0" />
                  {!recolhido && <span className="flex-1 truncate">{m.label}</span>}
                  {!recolhido && !m.pronto && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">em breve</span>}
                </>
              );
              const cls = cn("flex h-9 items-center gap-3 rounded-lg px-3 text-sm", ativo ? "bg-brand-600 text-white" : m.pronto ? "hover:bg-slate-800 hover:text-white" : "cursor-not-allowed opacity-50");
              return m.pronto
                ? <Link key={m.label} href={m.href} className={cls} title={m.label}>{conteudo}</Link>
                : <span key={m.label} className={cls} title={`${m.label} — próxima fase`}>{conteudo}</span>;
            })}
          </nav>
          <button onClick={alternarMenu} className="m-2 flex h-9 items-center gap-3 rounded-lg px-3 text-sm hover:bg-slate-800" aria-label="Recolher menu">
            {recolhido ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Recolher</>}
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
            <form className="relative max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); router.push(`/empresas/?q=${encodeURIComponent(busca)}`); }}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa, e-mail ou CNPJ…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
            </form>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={alternarTema} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Alternar tema">{escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <div className="ml-2 hidden text-right sm:block">
                <div className="text-sm font-medium leading-tight">{sessao!.email}</div>
                <div className="text-xs text-slate-500">{PAPEIS[sessao!.papel]}</div>
              </div>
              <button onClick={sair} className="ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Sair"><LogOut className="h-4 w-4" /></button>
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
            {itens.filter((m) => m.pronto).map((m) => (
              <Link key={m.label} href={m.href} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-sm", path?.startsWith(m.href.replace(/\/$/, "")) ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>{m.label}</Link>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <div className="fixed bottom-4 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg", t.tipo === "ok" ? "bg-emerald-600" : "bg-red-600")}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function PageHeader({ titulo, sub, acoes }: { titulo: string; sub?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {acoes}
    </div>
  );
}
