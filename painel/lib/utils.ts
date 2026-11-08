import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

export const brl = (v: number | string | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const num = (v: number | string | null | undefined, casas = 3) =>
  Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
export const pct = (v: number | string | null | undefined) =>
  `${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const dataHora = (v?: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
export const data = (v?: string | null) =>
  v ? new Date(v.length === 10 ? v + "T12:00:00" : v).toLocaleDateString("pt-BR") : "—";
export const hojeISO = (deltaDias = 0) => {
  const d = new Date(Date.now() + deltaDias * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
/** "12,5" → 12.5 ; "" → null */
export const numOuNull = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const s = String(v).trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
export const soDigitos = (v?: string | null) => (v || "").replace(/\D/g, "");
export const linkWhats = (tel?: string | null, msg?: string) => {
  let d = soDigitos(tel);
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}${msg ? `?text=${encodeURIComponent(msg)}` : ""}`;
};
export const preencher = (modelo: string, v: Record<string, string>) => modelo.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export function erroMsg(e: unknown) {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: string }).message) : String(e);
  if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar";
  if (/already registered/i.test(m)) return "Este e-mail já tem conta. Use Entrar.";
  if (/Password should be/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres";
  if (/row-level security/i.test(m)) return "Você não tem permissão para esta ação (ou a empresa está suspensa)";
  if (/duplicate key.*codigo/i.test(m)) return "Já existe um cadastro com esse código";
  if (/violates foreign key/i.test(m)) return "Este registro está em uso e não pode ser apagado";
  if (/Failed to fetch/i.test(m)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return m;
}

// ---------- Rótulos ----------
export const PAPEIS_EMPRESA: Record<string, string> = {
  dono: "Proprietário", admin: "Administrador", comercial: "Comercial", producao: "Produção",
  estoque: "Estoque", financeiro: "Financeiro", expedicao: "Expedição", operador: "Operador (antigo)",
};
export const PERMISSOES: Record<string, string> = {
  clientes_ver: "Visualizar clientes", clientes_editar: "Editar clientes",
  orcamentos_ver: "Ver orçamentos", orcamentos_criar: "Criar orçamentos", descontos_aprovar: "Aprovar descontos",
  pedidos_ver: "Ver pedidos", pedidos_editar: "Editar pedidos", producao_gerenciar: "Gerenciar produção",
  impressoras_ver: "Ver impressoras", impressoras_editar: "Editar impressoras",
  materia_ver: "Ver matéria-prima", materia_editar: "Cadastrar matéria-prima", materia_movimentar: "Movimentar matéria-prima",
  produtos_ver: "Ver produtos", produtos_editar: "Editar produtos", custos_ver: "Consultar custos",
  financeiro_ver: "Consultar financeiro", compras_gerenciar: "Registrar compras", relatorios_ver: "Ver relatórios",
  usuarios_admin: "Administrar usuários", integracoes_config: "Configurar integrações", config_editar: "Configurar a empresa",
  expedicao_gerenciar: "Gerenciar expedição",
};
export const STATUS_PEDIDO: Record<string, string> = {
  orcamento: "Aguardando", aprovado: "Aprovado", em_producao: "Em produção", pronto: "Pronto", entregue: "Entregue", cancelado: "Cancelado",
};
export const STATUS_ORCAMENTO: Record<string, string> = {
  rascunho: "Rascunho", enviado: "Enviado", aprovado: "Aprovado", rejeitado: "Recusado", convertido: "Virou pedido", cancelado: "Cancelado",
};
export const ETAPAS_CRM: Record<string, string> = {
  novo_contato: "Novo contato", aguardando_arquivo: "Aguardando arquivo", em_orcamento: "Em orçamento",
  orcamento_enviado: "Orçamento enviado", negociacao: "Negociação", aprovado: "Aprovado", perdido: "Perdido",
};
export const STATUS_IMPRESSORA: Record<string, string> = {
  disponivel: "Disponível", reservada: "Reservada", imprimindo: "Imprimindo", pausada: "Pausada", manutencao: "Manutenção", inativa: "Inativa",
};
export const TECNOLOGIAS: Record<string, string> = { fdm: "FDM (filamento)", sla: "SLA (resina)", msla: "MSLA (resina LCD)", outra: "Outra" };
export const CAT_MATERIA: Record<string, string> = {
  filamento: "Filamentos", resina: "Resinas", consumivel: "Consumíveis", componente: "Componentes", embalagem: "Embalagens",
  peca_reposicao: "Peças de reposição", outro: "Outros insumos", sublimacao: "Sublimação", laser: "Laser", bordado: "Bordado",
};
export const MATERIAIS_3D = ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PC", "Resina padrão", "Resina ABS-like", "Resina flexível"];
export const UNIDADES = ["kg", "g", "bobina", "l", "ml", "un", "m", "cx", "pct"];
export const TIPOS_COMPRA: Record<string, string> = {
  filamento: "Filamento", materia_prima: "Matéria-prima", insumo: "Insumo", ferramenta: "Ferramenta", embalagem: "Embalagem",
  manutencao: "Peças e manutenção", acessorio: "Acessórios / componentes", escritorio_limpeza: "Escritório e limpeza", outro: "Outro",
};
export const CAT_GASTO: Record<string, string> = {
  material: "Material", equipamento: "Equipamento", manutencao: "Manutenção", energia: "Energia", frete: "Frete",
  marketing: "Marketing", taxas: "Taxas", outro: "Outro",
};
export const TIPOS_SERVICO: Record<string, string> = { impressao_3d: "Impressão 3D", sublimacao: "Sublimação", laser: "Laser", bordado: "Bordado", outro: "Outro" };
export const TIPOS_PRODUTO: Record<string, string> = {
  simples: "Simples", variacoes: "Com variações", kit: "Kit", sob_encomenda: "Sob encomenda", pronta_entrega: "Pronta entrega",
};
export const STATUS_ASSINATURA: Record<string, string> = {
  teste: "Em teste", ativa: "Ativa", pendente: "Pendente", atrasada: "Atrasada", suspensa: "Suspensa", cancelada: "Cancelada",
};
export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
