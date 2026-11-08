// Motor de precificação — espelho exato das fórmulas do banco (private.calcular_item_orcamento, versão 2).
// O banco é a fonte oficial (recalcula ao salvar); aqui serve para a prévia instantânea na tela e para os testes.
export const VERSAO_CALCULO = 2;

export type Config = {
  energia_kwh: number; mao_obra_hora: number; margem_pct: number; impostos_pct: number; taxas_pct: number; desperdicio_pct: number;
  custos_fixos_mensais: number; horas_produtivas_mes: number; falha_metodo: "nenhum" | "percentual" | "sucesso"; falha_pct: number; taxa_sucesso_pct: number;
};
export type Maquina = { potencia_w: number; custo_aquisicao: number; valor_residual: number; vida_util_horas: number; custo_manutencao_hora: number; custo_operacional_hora: number };
export type FilamentoUso = { gramas: number; preco_kg: number };
export type Entrada = {
  filamentos: FilamentoUso[]; tempo_h: number; quantidade: number; mao_obra_h?: number; acabamento?: number; pintura?: number; embalagem?: number; suportes?: number;
  outros?: number; frete_assumido?: number; desconto_terceiros?: number; margem_pct?: number | null; impostos_pct?: number | null; taxas_pct?: number | null; desperdicio_pct?: number | null;
  preco_manual?: number | null;
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** depreciação/h = (aquisição − residual) / vida útil */
export function depreciacaoHora(m: Pick<Maquina, "custo_aquisicao" | "valor_residual" | "vida_util_horas">) {
  if (!(m.vida_util_horas > 0)) throw new Error("A vida útil precisa ser maior que zero");
  if (m.valor_residual > m.custo_aquisicao) throw new Error("O valor residual não pode passar da aquisição");
  return (m.custo_aquisicao - m.valor_residual) / m.vida_util_horas;
}
/** custo/hora técnico (sem energia, que é calculada à parte) */
export const custoHoraMaquina = (m: Maquina) => r4(depreciacaoHora(m) + m.custo_manutencao_hora + m.custo_operacional_hora);
export const custoMaterial = (gramas: number, precoKg: number) => (gramas / 1000) * precoKg;
/** energia = kW × horas × tarifa */
export const custoEnergia = (watts: number, horas: number, tarifa: number) => (watts / 1000) * horas * tarifa;

export function calcularItem(e: Entrada, c: Config, m: Maquina | null) {
  const neg = [e.tempo_h, e.quantidade, e.mao_obra_h ?? 0, e.acabamento ?? 0, e.pintura ?? 0, e.embalagem ?? 0, e.suportes ?? 0, e.outros ?? 0, e.frete_assumido ?? 0, ...e.filamentos.map((f) => f.gramas)];
  if (neg.some((x) => !Number.isFinite(x) || x < 0)) throw new Error("Pesos, tempos, quantidades e custos não podem ser negativos");
  const margem = e.margem_pct ?? c.margem_pct, imp = e.impostos_pct ?? c.impostos_pct, tax = e.taxas_pct ?? c.taxas_pct, desp = e.desperdicio_pct ?? c.desperdicio_pct;
  const den = 1 - (margem + imp + tax) / 100;
  if (den <= 0) throw new Error("A soma de margem, impostos e taxas precisa ser menor que 100%");
  const material = r4(e.filamentos.reduce((s, f) => s + custoMaterial(f.gramas, f.preco_kg), 0) * (1 + desp / 100));
  const energia = r4(custoEnergia(m?.potencia_w ?? 0, e.tempo_h, c.energia_kwh));
  const maquina = r4(e.tempo_h * (m ? custoHoraMaquina(m) : 0));
  const maoObra = r4((e.mao_obra_h ?? 0) * c.mao_obra_hora);
  const direto = material + energia + maquina + maoObra + (e.suportes ?? 0) + (e.acabamento ?? 0) + (e.pintura ?? 0) + (e.embalagem ?? 0) + (e.outros ?? 0);
  const falha = r4(c.falha_metodo === "percentual" ? direto * c.falha_pct / 100
    : c.falha_metodo === "sucesso" ? (material + energia + maquina) * (100 / Math.max(c.taxa_sucesso_pct, 1) - 1) : 0);
  const custoUnit = r4(direto + falha + (e.frete_assumido ?? 0));
  const fixo = r4(c.horas_produtivas_mes > 0 ? e.tempo_h * c.custos_fixos_mensais / c.horas_produtivas_mes : 0);
  if ((e.desconto_terceiros ?? 0) > custoUnit) throw new Error("Desconto de terceiros maior que o custo do item");
  const precoUnit = e.preco_manual ?? r2((custoUnit + fixo - (e.desconto_terceiros ?? 0)) / den);
  const precoTotal = r2(precoUnit * e.quantidade);
  const custoTotal = r2((custoUnit - (e.desconto_terceiros ?? 0)) * e.quantidade);
  const impostos = r2(precoTotal * imp / 100), taxas = r2(precoTotal * tax / 100);
  const lucroBruto = r2(precoTotal - custoTotal - impostos - taxas);
  const lucroOperacional = r2(lucroBruto - fixo * e.quantidade);
  return {
    versao: VERSAO_CALCULO, porUnidade: { material, energia, maquina, maoObra, falha, fixo, custo: custoUnit }, precoUnit, precoTotal, custoTotal, impostos, taxas,
    lucroBruto, lucroOperacional, margemReal: precoTotal > 0 ? lucroOperacional / precoTotal : 0, markup: custoTotal > 0 ? precoTotal / custoTotal - 1 : 0,
    /** preço mínimo que só cobre custos, impostos e taxas (margem zero) */
    precoMinimo: r2((custoUnit + fixo) / (1 - (imp + tax) / 100)),
  };
}

/** Divide uma placa entre as peças impressas juntas: o tempo da placa NÃO é multiplicado por peça */
export function ratearPlaca(p: { tempo_h: number; filamentos: FilamentoUso[]; pecas: number; impressoes: number }) {
  if (!(p.pecas >= 1)) throw new Error("Placa sem peças");
  return { tempo_h: p.tempo_h / p.pecas, filamentos: p.filamentos.map((f) => ({ ...f, gramas: f.gramas / p.pecas })), quantidade: p.pecas * p.impressoes };
}

/** custo real × previsto (depois da produção) */
export function comparar(previsto: number, real: number) {
  return { diferenca: r2(real - previsto), percentual: previsto > 0 ? Math.round(((real - previsto) / previsto) * 1000) / 10 : null };
}
