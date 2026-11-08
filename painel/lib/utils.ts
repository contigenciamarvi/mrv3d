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

// ---------- Fase 3 ----------
export const STATUS_PAGAMENTO: Record<string, string> = { aguardando: "Aguardando pagamento", parcial: "Pago parcialmente", pago: "Pago" };
export const STATUS_PRODUCAO: Record<string, string> = { aguardando: "Aguardando produção", em_producao: "Em produção", acabamento: "Acabamento", qualidade: "Controle de qualidade", concluida: "Produzido", nao_aplica: "Sem produção" };
export const STATUS_ENTREGA: Record<string, string> = { pendente: "Entrega pendente", pronto: "Pronto para envio", enviado: "Enviado", entregue: "Entregue", retirado: "Retirado" };
export const STATUS_OP: Record<string, string> = {
  planejada: "Planejada", aguardando_material: "Aguardando material", na_fila: "Na fila", imprimindo: "Imprimindo", pausada: "Pausada",
  falha: "Falha", acabamento: "Aguardando acabamento", qualidade: "Controle de qualidade", concluida: "Concluída", cancelada: "Cancelada",
};
export const PRIORIDADES: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
export const FORMAS_PAGAMENTO = ["Pix", "Dinheiro", "Cartão de crédito", "Cartão de débito", "Boleto", "Transferência", "Outro"];
export const CAT_FINANCEIRO: Record<string, string> = {
  filamentos: "Filamentos", resinas: "Resinas", energia: "Energia", manutencao: "Manutenção", equipamentos: "Equipamentos", embalagens: "Embalagens",
  fretes: "Fretes", mao_de_obra: "Mão de obra", impostos: "Impostos", taxas_financeiras: "Taxas financeiras", publicidade: "Publicidade",
  aluguel: "Aluguel", software: "Softwares e assinaturas", vendas: "Vendas", servicos: "Serviços", outros: "Outros",
};
/** Etapa única do pedido (lista do prompt), derivada dos três status independentes */
export function etapaPedido(p: { status: string; status_pagamento: string; status_producao: string; status_entrega: string }): [string, string] {
  if (p.status === "cancelado") return ["Cancelado", "cancelado"];
  if (p.status_entrega === "entregue" || p.status_entrega === "retirado") return ["Entregue", "entregue"];
  if (p.status_entrega === "enviado") return ["Enviado", "enviado"];
  if (p.status_entrega === "pronto" || p.status_producao === "concluida") return ["Pronto para envio", "pronto"];
  if (p.status_producao === "qualidade") return ["Controle de qualidade", "em_producao"];
  if (p.status_producao === "acabamento") return ["Acabamento", "em_producao"];
  if (p.status_producao === "em_producao") return ["Em produção", "em_producao"];
  if (p.status_pagamento === "aguardando") return ["Aguardando pagamento", "pendente"];
  return ["Aguardando produção", "aprovado"];
}

// ---------- Fase 4 ----------
export const STATUS_COMPRA: Record<string, string> = {
  rascunho: "Rascunho", solicitado: "Aguardando aprovação", aprovado: "Aprovada", enviado: "Pedido ao fornecedor", parcial: "Recebida em parte", recebido: "Recebida", cancelado: "Cancelada",
};
export const SERVICOS_MANUTENCAO: Record<string, string> = {
  troca_bico: "Troca de bico", troca_correia: "Troca de correia", lubrificacao: "Lubrificação", calibracao: "Calibração", limpeza: "Limpeza",
  substituicao_componente: "Substituição de componente", firmware: "Atualização de firmware", outro: "Outro",
};
export const STATUS_MANUTENCAO: Record<string, string> = { agendada: "Agendada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
export const STATUS_ENVIO: Record<string, string> = {
  separacao: "Separação", conferencia: "Conferência", embalado: "Embalado", aguardando_coleta: "Aguardando coleta", enviado: "Enviado",
  em_transito: "Em trânsito", entregue: "Entregue", retirado: "Retirado", devolvido: "Devolvido", cancelado: "Cancelado",
};
export const MODALIDADES_ENVIO: Record<string, string> = {
  retirada: "Retirada no local", entrega_propria: "Entrega própria", correios: "Correios", transportadora: "Transportadora", melhor_envio: "Melhor Envio",
};
export const STATUS_PORTAL: Record<string, string> = { nova: "Nova", em_analise: "Em análise", orcada: "Orçamento criado", recusada: "Recusada", cancelada: "Cancelada" };

/** Baixa um CSV (separador ;, com BOM para o Excel abrir acentos) */
export function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const t = "﻿" + linhas.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv" })); a.download = `${nome}.csv`; a.click();
}
/** número em formato brasileiro para CSV (vírgula decimal) */
export const csvNum = (v: unknown) => (v == null || v === "" ? "" : String(v).replace(".", ","));
