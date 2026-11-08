"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, FileText, ShoppingCart, Factory, Printer, Boxes, Package, Truck, Wallet, Wrench, Send,
  BarChart3, Store, UserCog, Plug, Settings, CreditCard, PanelLeftClose, PanelLeftOpen, Moon, Sun, LogOut, Search,
  Loader2, Bell, ChevronRight, Building2, X, AlertTriangle, Activity, Layers,
} from "lucide-react";
import { sb, rpc } from "@/lib/supabase";
import { cn, PAPEIS_EMPRESA } from "@/lib/utils";
import type { Toast } from "@/lib/toast";

export type Config = {
  empresa_id: string; logo_path: string | null; energia_kwh: number; mao_obra_hora: number; margem_pct: number; impostos_pct: number;
  taxas_pct: number; desperdicio_pct: number; custos_fixos_mensais: number; embalagem_padrao: number; desconto_livre_pct: number;
  moeda: string; fuso: string; prefixo_pedido: string; prefixo_orcamento: string; prazo_padrao_dias: number; validade_orcamento_dias: number;
  msg_orcamento: string; msg_pedido: string; onboarding_etapa: number; onboarding_concluido: boolean; horas_produtivas_mes?: number; falha_metodo?: "nenhum" | "percentual" | "sucesso"; falha_pct?: number; taxa_sucesso_pct?: number;
};
type Empresa = { id: string; nome: string; papel: string; status: string };
type Ctx = {
  userId: string; email: string; empresa: Empresa; empresas: Empresa[]; papel: string; permissoes: string[];
  pode: (p: string) => boolean; podeEscrever: boolean; config: Config; recarregar: () => Promise<void>; trocarEmpresa: (id: string) => void;
};
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

type Item = { href: string; label: string; icon: typeof LayoutDashboard; perm?: string[]; pronto: boolean };
const MENU: Item[] = [
  { href: "/dashboard/", label: "Dashboard", icon: LayoutDashboard, pronto: true },
  { href: "/clientes/", label: "Clientes", icon: Users, perm: ["clientes_ver"], pronto: true },
  { href: "/orcamentos/", label: "Orçamentos", icon: FileText, perm: ["orcamentos_ver", "orcamentos_criar"], pronto: true },
  { href: "/pedidos/", label: "Pedidos e Vendas", icon: ShoppingCart, perm: ["pedidos_ver"], pronto: true },
  { href: "/producao/", label: "Ordens de Produção", icon: Factory, perm: ["producao_gerenciar", "pedidos_ver"], pronto: true },
  { href: "/impressoras/", label: "Impressoras 3D", icon: Printer, perm: ["impressoras_ver"], pronto: true },
  { href: "/impressoras/monitoramento/", label: "Monitoramento", icon: Activity, perm: ["impressoras_ver", "producao_gerenciar"], pronto: true },
  { href: "/materia-prima/", label: "Matéria-prima", icon: Boxes, perm: ["materia_ver"], pronto: true },
  { href: "/produtos/", label: "Produtos", icon: Package, perm: ["produtos_ver"], pronto: true },
  { href: "/projetos/", label: "Projetos 3D", icon: Layers, perm: ["produtos_ver", "orcamentos_criar", "producao_gerenciar"], pronto: true },
  { href: "/compras/", label: "Compras e Fornecedores", icon: Truck, perm: ["compras_gerenciar", "financeiro_ver"], pronto: true },
  { href: "/financeiro/", label: "Financeiro", icon: Wallet, perm: ["financeiro_ver"], pronto: true },
  { href: "/manutencao/", label: "Manutenção", icon: Wrench, perm: ["impressoras_ver"], pronto: true },
  { href: "/expedicao/", label: "Expedição e Entregas", icon: Send, perm: ["expedicao_gerenciar", "pedidos_ver"], pronto: true },
  { href: "/relatorios/", label: "Relatórios", icon: BarChart3, perm: ["relatorios_ver", "financeiro_ver", "compras_gerenciar"], pronto: true },
  { href: "/portal/", label: "Portal do Comprador", icon: Store, perm: ["orcamentos_ver", "orcamentos_criar", "config_editar"], pronto: true },
  { href: "/equipe/", label: "Equipe e Permissões", icon: UserCog, pronto: true },
  { href: "/integracoes/", label: "Integrações", icon: Plug, pronto: true },
  { href: "/configuracoes/", label: "Configurações", icon: Settings, perm: ["config_editar"], pronto: true },
  { href: "/assinatura/", label: "Minha Assinatura", icon: CreditCard, pronto: true },
];

type Notif = { id: string; tipo: string; nivel: string; titulo: string; texto: string; link: string };
type Resultado = Record<string, { id: string; titulo: string; sub?: string }[]>;
const DESTINO_BUSCA: Record<string, [string, string]> = {
  clientes: ["Clientes", "/clientes/?id="], produtos: ["Produtos", "/produtos/?id="], orcamentos: ["Orçamentos", "/orcamentos/editar/?id="],
  pedidos: ["Pedidos", "/pedidos/?id="], materiais: ["Matéria-prima", "/materia-prima/?id="], impressoras: ["Impressoras", "/impressoras/?id="],
};

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() || "";
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [erroInicial, setErroInicial] = useState("");
  const [recolhido, setRecolhido] = useState(false);
  const [escuro, setEscuro] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [lidas, setLidas] = useState<string[]>([]);
  const [abrirNotif, setAbrirNotif] = useState(false);
  const [busca, setBusca] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [menuMobile, setMenuMobile] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async (empresaPreferida?: string) => {
    const { data: s } = await sb().auth.getSession();
    const u = s.session?.user;
    if (!u) { router.replace("/login/"); return; }
    const empresas = await rpc<Empresa[]>("minhas_empresas");
    if (!empresas?.length) { router.replace("/criar-empresa/"); return; }
    let escolhida = empresaPreferida;
    try { escolhida = escolhida || localStorage.getItem("empresa") || undefined; } catch {}
    const empresa = empresas.find((e) => e.id === escolhida) || empresas[0];
    try { localStorage.setItem("empresa", empresa.id); } catch {}
    const [perm, cfg] = await Promise.all([
      rpc<{ papel: string; permissoes: string[] }>("minhas_permissoes", { p_empresa: empresa.id }),
      sb().from("empresa_config").select("*").eq("empresa_id", empresa.id).single(),
    ]);
    if (cfg.error) throw cfg.error;
    const permissoes = perm?.permissoes || [];
    const pode = (p: string) => permissoes.includes("*") || permissoes.includes(p);
    const config = cfg.data as Config;
    setCtx({
      userId: u.id, email: u.email || "", empresa, empresas, papel: perm?.papel || empresa.papel, permissoes, pode,
      podeEscrever: !["suspensa", "cancelada"].includes(empresa.status), config,
      recarregar: () => carregar(empresa.id), trocarEmpresa: (id) => { carregar(id).then(() => router.push("/dashboard/")); },
    });
    if (!config.onboarding_concluido && pode("config_editar") && !path.startsWith("/onboarding")) router.replace("/onboarding/");
  }, [router, path]);

  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem("menu-recolhido") === "1");
      const d = localStorage.getItem("tema") === "escuro";
      setEscuro(d); document.documentElement.classList.toggle("dark", d);
      setLidas(JSON.parse(localStorage.getItem("notif-lidas") || "[]"));
    } catch {}
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setToasts((x) => [...x, t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 4500);
    };
    window.addEventListener("app-toast", onToast);
    carregar().catch((e) => setErroInicial(e?.message || String(e)));
    const { data: sub } = sb().auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") router.replace("/login/"); });
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); buscaRef.current?.focus(); }
    };
    window.addEventListener("keydown", atalho);
    return () => { window.removeEventListener("app-toast", onToast); window.removeEventListener("keydown", atalho); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // notificações
  useEffect(() => {
    if (!ctx) return;
    const f = () => rpc<Notif[]>("minhas_notificacoes", { p_empresa: ctx.empresa.id }).then((n) => setNotifs(n || [])).catch(() => {});
    f(); const t = setInterval(f, 120000);
    return () => clearInterval(t);
  }, [ctx]);

  // busca global
  useEffect(() => {
    if (!ctx || busca.trim().length < 2) { setResultado(null); return; }
    const t = setTimeout(() => {
      rpc<Resultado>("busca_global", { p_empresa: ctx.empresa.id, p_termo: busca }).then(setResultado).catch(() => setResultado(null));
    }, 250);
    return () => clearTimeout(t);
  }, [busca, ctx]);

  useEffect(() => { setMenuMobile(false); setResultado(null); setBusca(""); setAbrirNotif(false); }, [path]);

  const alternarTema = () => {
    const d = !escuro; setEscuro(d); document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("tema", d ? "escuro" : "claro"); } catch {}
  };
  const alternarMenu = () => {
    const r = !recolhido; setRecolhido(r);
    try { localStorage.setItem("menu-recolhido", r ? "1" : "0"); } catch {}
  };
  const marcarLidas = () => {
    const ids = Array.from(new Set([...lidas, ...notifs.map((n) => n.id)])).slice(-300);
    setLidas(ids); try { localStorage.setItem("notif-lidas", JSON.stringify(ids)); } catch {}
  };
  const sair = async () => { await sb().auth.signOut(); router.replace("/login/"); };

  if (erroInicial) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p>Não foi possível carregar o painel: {erroInicial}</p>
        <div className="flex gap-3"><button onClick={() => location.reload()} className="text-brand-600 underline">Tentar de novo</button>
          <button onClick={sair} className="text-slate-500 underline">Sair</button></div>
      </div>
    );
  }
  if (!ctx) return <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;

  const itens = MENU.filter((m) => !m.perm || m.perm.some((p) => ctx.pode(p)));
  const naoLidas = notifs.filter((n) => !lidas.includes(n.id));
  // o item mais específico vence (ex.: /impressoras/monitoramento/ antes de /impressoras/)
  const atual = MENU.filter((m) => m.pronto && path.startsWith(m.href.replace(/\/$/, ""))).sort((a, b) => b.href.length - a.href.length)[0];

  const Nav = ({ compacto }: { compacto: boolean }) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
      {itens.map((m) => {
        const ativo = m === atual;
        const Icon = m.icon;
        const conteudo = (
          <>
            <Icon className="h-4 w-4 shrink-0" />
            {!compacto && <span className="flex-1 truncate">{m.label}</span>}
            {!compacto && !m.pronto && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">em breve</span>}
          </>
        );
        const cls = cn("flex h-9 items-center gap-3 rounded-lg px-3 text-sm", ativo ? "bg-brand-600 text-white" : m.pronto ? "hover:bg-slate-800 hover:text-white" : "cursor-not-allowed opacity-45");
        return m.pronto
          ? <Link key={m.label} href={m.href} className={cls} title={m.label}>{conteudo}</Link>
          : <span key={m.label} className={cls} title={`${m.label} — chega na próxima fase`}>{conteudo}</span>;
      })}
    </nav>
  );
  const Marca = ({ compacto }: { compacto: boolean }) => (
    <div className="flex h-14 items-center gap-2 px-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">M3</div>
      {!compacto && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold text-white">{ctx.empresa.nome}</div><div className="text-[11px] text-slate-400">{PAPEIS_EMPRESA[ctx.papel] || ctx.papel}</div></div>}
    </div>
  );

  return (
    <AppCtx.Provider value={ctx}>
      <div className="flex min-h-screen">
        <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-slate-900 text-slate-300 transition-all md:flex print:hidden", recolhido ? "w-16" : "w-64")}>
          <Marca compacto={recolhido} />
          <Nav compacto={recolhido} />
          <button onClick={alternarMenu} className="m-2 flex h-9 items-center gap-3 rounded-lg px-3 text-sm hover:bg-slate-800" aria-label={recolhido ? "Expandir menu" : "Recolher menu"}>
            {recolhido ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Recolher</>}
          </button>
        </aside>
        {menuMobile && (
          <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setMenuMobile(false)}>
            <aside className="flex h-full w-72 flex-col bg-slate-900 text-slate-300" onClick={(e) => e.stopPropagation()}>
              <Marca compacto={false} /><Nav compacto={false} />
            </aside>
            <div className="flex-1 bg-slate-950/50" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur md:px-4 dark:border-slate-800 dark:bg-slate-900/90 print:hidden">
            <button onClick={() => setMenuMobile(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" aria-label="Abrir menu"><PanelLeftOpen className="h-5 w-5" /></button>
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={buscaRef} value={busca} onChange={(e) => setBusca(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setBusca("")}
                placeholder="Buscar clientes, produtos, pedidos…  (Ctrl+K)" aria-label="Busca global"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
              {resultado && (
                <div className="absolute left-0 right-0 top-11 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  {Object.entries(resultado).every(([, v]) => !v?.length) && <div className="p-3 text-sm text-slate-500">Nada encontrado para “{busca}”.</div>}
                  {Object.entries(resultado).filter(([, v]) => v?.length).map(([k, lista]) => (
                    <div key={k} className="mb-1">
                      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{DESTINO_BUSCA[k]?.[0] || k}</div>
                      {lista.map((r) => (
                        <Link key={r.id} href={(DESTINO_BUSCA[k]?.[1] || "/") + r.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                          <span className="truncate">{r.titulo}</span><span className="ml-2 shrink-0 text-xs text-slate-400">{r.sub}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {ctx.empresas.length > 1 && (
                <label className="hidden items-center gap-1 sm:flex" title="Trocar de empresa">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  <select value={ctx.empresa.id} onChange={(e) => ctx.trocarEmpresa(e.target.value)} aria-label="Empresa"
                    className="h-9 max-w-40 rounded-lg border border-slate-200 bg-transparent px-2 text-sm dark:border-slate-700">
                    {ctx.empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </label>
              )}
              <div className="relative">
                <button onClick={() => { setAbrirNotif(!abrirNotif); }} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Notificações">
                  <Bell className="h-4 w-4" />
                  {naoLidas.length > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{naoLidas.length}</span>}
                </button>
                {abrirNotif && (
                  <div className="absolute right-0 top-11 z-40 w-80 rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                      <span className="text-sm font-semibold">Notificações</span>
                      <div className="flex items-center gap-2">
                        {naoLidas.length > 0 && <button onClick={marcarLidas} className="text-xs text-brand-600 hover:underline">Marcar como lidas</button>}
                        <button onClick={() => setAbrirNotif(false)} aria-label="Fechar"><X className="h-4 w-4 text-slate-400" /></button>
                      </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifs.length === 0 && <div className="p-4 text-sm text-slate-500">Tudo em dia por aqui.</div>}
                      {notifs.map((n) => (
                        <Link key={n.id} href={n.link} className={cn("block border-b border-slate-50 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800", !lidas.includes(n.id) && "bg-brand-50/60 dark:bg-brand-500/10")}>
                          <div className={cn("font-medium", n.nivel === "erro" && "text-red-600", n.nivel === "alerta" && "text-amber-700 dark:text-amber-400", n.nivel === "sucesso" && "text-emerald-700 dark:text-emerald-400")}>{n.titulo}</div>
                          <div className="text-xs text-slate-500">{n.texto}</div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={alternarTema} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Alternar tema claro/escuro">{escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
              <div className="ml-1 hidden text-right lg:block">
                <div className="max-w-48 truncate text-sm font-medium leading-tight">{ctx.email}</div>
                <div className="text-xs text-slate-500">{PAPEIS_EMPRESA[ctx.papel] || ctx.papel}</div>
              </div>
              <button onClick={sair} className="ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Sair"><LogOut className="h-4 w-4" /></button>
            </div>
          </header>
          {!ctx.podeEscrever && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 print:hidden">
              Sua empresa está <b>{ctx.empresa.status}</b>: você pode consultar os dados, mas não pode fazer alterações. <Link href="/assinatura/" className="underline">Ver assinatura</Link>
            </div>
          )}
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6 print:max-w-none print:p-0">
            {atual && (
              <div className="mb-2 flex items-center gap-1 text-xs text-slate-400 print:hidden" aria-label="Você está em">
                <Link href="/dashboard/" className="hover:text-slate-600">Início</Link><ChevronRight className="h-3 w-3" />
                <span>{atual.label}</span>
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
      <div className="fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 print:hidden" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg", t.tipo === "ok" ? "bg-emerald-600" : "bg-red-600")}>{t.msg}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

export function PageHeader({ titulo, sub, acoes }: { titulo: string; sub?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

/** Mostra o conteúdo só para quem tem a permissão */
export function Exige({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { pode } = useApp();
  const lista = Array.isArray(perm) ? perm : [perm];
  if (!lista.some(pode)) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Seu perfil não tem acesso a esta área. Fale com o proprietário da empresa.</div>;
  }
  return <>{children}</>;
}
