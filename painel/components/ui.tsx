"use client";
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Loader2, AlertTriangle, Inbox, X } from "lucide-react";
import { cn } from "@/lib/utils";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-brand-600 text-zinc-950 hover:bg-brand-500",
        variant === "secondary" && "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>{children}</div>;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {right}
    </div>
  );
}

const fieldCls = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-950";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(fieldCls, p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(fieldCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cn(fieldCls, "h-auto min-h-20 py-2", p.className)} />
);

const tons: Record<string, string> = {
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  azul: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400",
  amarelo: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  vermelho: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  cinza: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300",
};
export function Badge({ tom = "cinza", children }: { tom?: keyof typeof tons; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tons[tom])}>{children}</span>;
}

export const tomStatus = (s?: string): keyof typeof tons =>
  ({ ativa: "verde", paga: "verde", aprovado: "verde", convertido: "verde", entregue: "verde", disponivel: "verde", teste: "azul", aberta: "azul", enviado: "azul", em_producao: "azul", imprimindo: "azul", reservada: "azul", pronto: "verde", rascunho: "cinza", pendente: "amarelo", orcamento: "amarelo", manutencao: "amarelo", pausada: "amarelo", rejeitado: "vermelho", falha: "vermelho", aguardando_material: "amarelo", na_fila: "azul", acabamento: "azul", qualidade: "azul", concluida: "verde", planejada: "cinza", pago: "verde", parcial: "amarelo", aguardando: "amarelo", retirado: "verde", atrasada: "vermelho", vencida: "vermelho", suspensa: "amarelo", cancelada: "cinza", cancelado: "cinza", inativa: "cinza", reembolsada: "cinza", solicitado: "amarelo", recebido: "verde", agendada: "azul", em_andamento: "amarelo", separacao: "amarelo", conferencia: "amarelo", embalado: "azul", aguardando_coleta: "azul", em_transito: "azul", devolvido: "vermelho", nova: "amarelo", em_analise: "azul", orcada: "verde", recusada: "cinza" } as Record<string, keyof typeof tons>)[s || ""] || "cinza";

export function Loading({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {texto}
    </div>
  );
}

export function ErrorBox({ erro, onRetry }: { erro: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{erro}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button>}
    </div>
  );
}

export function Empty({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-sm text-slate-500">
      <Inbox className="h-6 w-6" /> {texto}
    </div>
  );
}

export function Modal({ aberto, titulo, onClose, children, largura = "max-w-lg" }: { aberto: boolean; titulo: string; onClose: () => void; children: ReactNode; largura?: string }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (aberto) window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [aberto, onClose]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className={cn("w-full rounded-xl bg-white shadow-xl dark:bg-slate-900", largura)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h3 className="font-semibold">{titulo}</h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className, onClick }: { children?: ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) => <td onClick={onClick} className={cn("px-3 py-2.5 align-middle", className)}>{children}</td>;

export function Kpi({ label, valor, sub, tom }: { label: string; valor: ReactNode; sub?: ReactNode; tom?: "verde" | "vermelho" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cn("tnum mt-1 text-2xl font-semibold", tom === "verde" && "text-emerald-600", tom === "vermelho" && "text-red-600")}>{valor}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Paginacao({ pagina, total, porPagina, onChange }: { pagina: number; total: number; porPagina: number; onChange: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>{total} registros · página {pagina} de {paginas}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}>Anterior</Button>
        <Button size="sm" variant="secondary" disabled={pagina >= paginas} onClick={() => onChange(pagina + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ abas, ativa, onChange }: { abas: [T, string][]; ativa: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {abas.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={ativa === k} onClick={() => onChange(k)}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", ativa === k ? "border-brand-600 text-brand-700 dark:text-brand-400" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Confirmar({ aberto, titulo, texto, onCancel, onOk, perigo, carregando, confirmar = "Confirmar", children }:
  { aberto: boolean; titulo: string; texto?: ReactNode; onCancel: () => void; onOk: () => void; perigo?: boolean; carregando?: boolean; confirmar?: string; children?: ReactNode }) {
  return (
    <Modal aberto={aberto} titulo={titulo} onClose={onCancel}>
      {texto && <div className="text-sm text-slate-600 dark:text-slate-300">{texto}</div>}
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Voltar</Button>
        <Button variant={perigo ? "danger" : "primary"} loading={carregando} onClick={onOk}>{confirmar}</Button>
      </div>
    </Modal>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return <div className={cn("grid gap-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>{children}</div>;
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

export function Aviso({ tom = "azul", children }: { tom?: "azul" | "amarelo" | "vermelho" | "verde"; children: ReactNode }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2 text-sm",
      tom === "azul" && "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
      tom === "amarelo" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      tom === "vermelho" && "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
      tom === "verde" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200")}>{children}</div>
  );
}
