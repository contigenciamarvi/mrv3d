import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

export const brl = (v: number | string | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dataHora = (v?: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export const data = (v?: string | null) =>
  v ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString("pt-BR") : "—";

export const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const PAPEIS: Record<string, string> = {
  proprietario: "Proprietário do SaaS",
  administrador: "Administrador",
  financeiro: "Financeiro",
  suporte: "Suporte",
  atendimento: "Operador de atendimento",
};

export const STATUS_EMPRESA: Record<string, string> = {
  teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada",
};

export const STATUS_ASSINATURA: Record<string, string> = {
  teste: "Em teste", ativa: "Ativa", pendente: "Pendente", atrasada: "Atrasada", suspensa: "Suspensa", cancelada: "Cancelada",
};

export const STATUS_FATURA: Record<string, string> = {
  aberta: "Aberta", paga: "Paga", vencida: "Vencida", cancelada: "Cancelada", reembolsada: "Reembolsada",
};

// o que cada perfil pode fazer na interface (o banco aplica as mesmas regras)
export const PODE = {
  verAuditoria: ["proprietario", "administrador"],
  gerirPlanos: ["proprietario", "administrador"],
  gerirAssinaturas: ["proprietario", "administrador", "financeiro"],
  gerirCobrancas: ["proprietario", "administrador", "financeiro"],
  gerirEquipe: ["proprietario", "administrador"],
  acessarLoja: ["proprietario", "administrador", "suporte"],
  editarEmpresa: ["proprietario", "administrador", "suporte"],
  verUsuarios: ["proprietario", "administrador", "suporte", "atendimento"],
  bloquearUsuario: ["proprietario", "administrador"],
} as const;

export const pode = (papel: string | null, acao: keyof typeof PODE) =>
  !!papel && (PODE[acao] as readonly string[]).includes(papel);
