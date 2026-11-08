// Testes do motor de precificação (mesmas fórmulas do banco). Rodar: npm run test:3d
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularItem, custoHoraMaquina, custoEnergia, custoMaterial, depreciacaoHora, ratearPlaca, comparar, type Config, type Maquina } from "../lib/precificacao.ts";

const cfg: Config = { energia_kwh: 1, mao_obra_hora: 20, margem_pct: 40, impostos_pct: 6, taxas_pct: 4, desperdicio_pct: 5, custos_fixos_mensais: 0, horas_produtivas_mes: 0,
  falha_metodo: "nenhum", falha_pct: 0, taxa_sucesso_pct: 100 };
const p1s: Maquina = { potencia_w: 200, custo_aquisicao: 6000, valor_residual: 1000, vida_util_horas: 5000, custo_manutencao_hora: 0.1, custo_operacional_hora: 0.2 };

test("1-4 material por grama, energia, depreciação e custo/hora", () => {
  assert.equal(custoMaterial(250, 100), 25);
  assert.equal(Math.round(custoEnergia(200, 3, 0.95) * 1e6) / 1e6, 0.57);
  assert.equal(depreciacaoHora(p1s), 1);
  assert.equal(custoHoraMaquina(p1s), 1.3);
  assert.throws(() => depreciacaoHora({ ...p1s, vida_util_horas: 0 }), /vida útil/);
  assert.throws(() => depreciacaoHora({ ...p1s, valor_residual: 7000 }), /residual/);
});

test("5-7 margem sobre o preço, impostos/taxas e arredondamento", () => {
  const r = calcularItem({ filamentos: [{ gramas: 100, preco_kg: 100 }], tempo_h: 2, quantidade: 1, desperdicio_pct: 0 }, cfg, p1s);
  // material 10 + energia 0,40 + máquina 2,60 = 13,00 → preço = 13 / (1 − 0,50) = 26,00
  assert.equal(r.porUnidade.custo, 13);
  assert.equal(r.precoUnit, 26);
  assert.equal(r.impostos, 1.56);
  assert.equal(r.taxas, 1.04);
  assert.equal(r.lucroBruto, 10.4); // 26 − 13 − 1,56 − 1,04
  assert.equal(Math.round(r.margemReal * 1000) / 10, 40);
  assert.equal(Math.round(r.markup * 1000) / 10, 100); // markup sobre custo ≠ margem sobre preço
  assert.equal(r.precoMinimo, 14.44); // 13 / 0,90
  const q = calcularItem({ filamentos: [{ gramas: 33.333, preco_kg: 99.99 }], tempo_h: 0.333, quantidade: 3 }, cfg, p1s);
  assert.equal(q.precoTotal, Math.round(q.precoUnit * 3 * 100) / 100);
  assert.equal(String(q.precoUnit).split(".")[1]?.length ?? 0 <= 2, true);
});

test("8 multicolorido: cada filamento com o próprio preço", () => {
  const r = calcularItem({ filamentos: [{ gramas: 100, preco_kg: 100 }, { gramas: 50, preco_kg: 80 }], tempo_h: 0, quantidade: 1, desperdicio_pct: 0 }, cfg, null);
  assert.equal(r.porUnidade.material, 14); // 10 + 4
});

test("9 e 11 várias placas, rateio por peça e lote", () => {
  const placa = ratearPlaca({ tempo_h: 4, filamentos: [{ gramas: 80, preco_kg: 100 }], pecas: 4, impressoes: 3 });
  assert.equal(placa.tempo_h, 1); // 4 h para 4 peças juntas = 1 h por peça, não 4 h
  assert.equal(placa.quantidade, 12);
  const porPeca = calcularItem({ ...placa, desperdicio_pct: 0 }, cfg, p1s);
  const porPlaca = calcularItem({ tempo_h: 4, filamentos: [{ gramas: 80, preco_kg: 100 }], quantidade: 3, desperdicio_pct: 0 }, cfg, p1s);
  assert.ok(Math.abs(porPeca.custoTotal - porPlaca.custoTotal) < 0.02);
  assert.throws(() => ratearPlaca({ tempo_h: 1, filamentos: [], pecas: 0, impressoes: 1 }), /peças/);
});

test("10 desperdício e reserva para falhas (um método só)", () => {
  const base = { filamentos: [{ gramas: 100, preco_kg: 100 }], tempo_h: 0, quantidade: 1 };
  assert.equal(calcularItem({ ...base, desperdicio_pct: 10 }, cfg, null).porUnidade.material, 11);
  const pct = calcularItem({ ...base, desperdicio_pct: 0 }, { ...cfg, falha_metodo: "percentual", falha_pct: 10 }, null);
  assert.equal(pct.porUnidade.falha, 1);
  const suc = calcularItem({ ...base, desperdicio_pct: 0 }, { ...cfg, falha_metodo: "sucesso", taxa_sucesso_pct: 80, falha_pct: 10 }, null);
  assert.equal(suc.porUnidade.falha, 2.5); // 10 / 0,8 − 10 (o percentual é ignorado)
});

test("custos fixos entram no preço e no lucro operacional, não no custo variável", () => {
  const r = calcularItem({ filamentos: [], tempo_h: 2, quantidade: 1 }, { ...cfg, custos_fixos_mensais: 1000, horas_produtivas_mes: 200 }, null);
  assert.equal(r.porUnidade.fixo, 10);
  assert.equal(r.custoTotal, 0);
  assert.equal(r.precoUnit, 20);
  assert.equal(r.lucroOperacional, r.lucroBruto - 10);
});

test("12 custo real versus previsto", () => {
  assert.deepEqual(comparar(10, 12.5), { diferenca: 2.5, percentual: 25 });
  assert.deepEqual(comparar(0, 3), { diferenca: 3, percentual: null });
});

test("13 campos inválidos", () => {
  assert.throws(() => calcularItem({ filamentos: [{ gramas: -1, preco_kg: 100 }], tempo_h: 1, quantidade: 1 }, cfg, null), /negativos/);
  assert.throws(() => calcularItem({ filamentos: [], tempo_h: -1, quantidade: 1 }, cfg, null), /negativos/);
  assert.throws(() => calcularItem({ filamentos: [], tempo_h: 1, quantidade: 1, margem_pct: 95 }, cfg, null), /100%/);
  assert.throws(() => calcularItem({ filamentos: [], tempo_h: 1, quantidade: 1, desconto_terceiros: 5 }, cfg, null), /Desconto/);
  assert.throws(() => calcularItem({ filamentos: [{ gramas: NaN, preco_kg: 1 }], tempo_h: 1, quantidade: 1 }, cfg, null), /negativos/);
});
