"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, data, hojeISO, numOuNull, TIPOS_COMPRA, CAT_GASTO, UNIDADES } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Grid, Table, Td, Loading, ErrorBox, Empty, Badge, Checkbox, Confirmar, Aviso } from "@/components/ui";

type Gasto = { id: string; descricao: string; categoria: string; valor: number; data: string; material_id: string | null };
const vazio = () => ({ tipo: "filamento", nome: "", detalhe: "", quantidade: "", unidade: "kg", valor: "", data: hojeISO(), minimo: "", lancar: true });

export default function Compras() { return <Exige perm="compras_gerenciar"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const [f, setF] = useState(vazio());
  const [salvando, setSalvando] = useState(false);
  const [mes, setMes] = useState(hojeISO().slice(0, 7));
  const [excluir, setExcluir] = useState<Gasto | null>(null);
  const verGastos = app.pode("financeiro_ver") || app.pode("compras_gerenciar");
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [itens, gastos] = await Promise.all([
      q<{ nome: string; cor: string | null; unidade: string; tipo_compra: string }[]>(sb().from("materiais").select("nome,cor,unidade,tipo_compra").eq("empresa_id", app.empresa.id).eq("ativo", true).order("nome")),
      verGastos ? q<Gasto[]>(sb().from("gastos").select("id,descricao,categoria,valor,data,material_id").eq("empresa_id", app.empresa.id)
        .gte("data", `${mes}-01`).lt("data", new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 1).toISOString().slice(0, 10)).order("data", { ascending: false })) : Promise.resolve([] as Gasto[]),
    ]);
    return { itens, gastos };
  }, [app.empresa.id, mes, verGastos]);

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const r = await rpc<{ saldo: number }>("registrar_compra", { p_empresa: app.empresa.id, p_tipo: f.tipo, p_nome: f.nome, p_quantidade: numOuNull(f.quantidade), p_valor_total: numOuNull(f.valor) ?? 0,
        p_unidade: f.unidade, p_detalhe: f.detalhe || null, p_data: f.data, p_estoque_minimo: numOuNull(f.minimo), p_lancar_gasto: f.lancar });
      toast(`Compra registrada. Saldo de ${f.nome}: ${r.saldo} ${f.unidade}`); setF({ ...vazio(), tipo: f.tipo, unidade: f.unidade }); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const sugestoes = (dados?.itens || []).filter((i) => i.tipo_compra === f.tipo);
  const total = (dados?.gastos || []).reduce((s, g) => s + Number(g.valor), 0);

  return (
    <>
      <PageHeader titulo="Compras e Fornecedores" sub="Registre compras: o item entra no estoque com custo e o valor vai para os gastos" />
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardTitle>Registrar compra</CardTitle>
          <form onSubmit={registrar} className="space-y-3">
            <fieldset disabled={!app.podeEscrever} className="space-y-3">
              <Field label="Tipo de compra"><Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS_COMPRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Item" hint="Se já existir com o mesmo nome e detalhe, soma no estoque"><Input required list="itens-compra" value={f.nome} onChange={(e) => {
                const it = sugestoes.find((i) => i.nome === e.target.value); setF({ ...f, nome: e.target.value, ...(it ? { detalhe: it.cor || "", unidade: it.unidade } : {}) }); }} /></Field>
              <datalist id="itens-compra">{sugestoes.map((i, k) => <option key={k} value={i.nome}>{i.cor}</option>)}</datalist>
              <Field label="Cor / detalhe"><Input value={f.detalhe} onChange={(e) => setF({ ...f, detalhe: e.target.value })} /></Field>
              <Grid>
                <Field label="Quantidade"><Input required inputMode="decimal" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} /></Field>
                <Field label="Unidade"><Select value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</Select></Field>
                <Field label="Valor total pago (R$)"><Input required inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Field>
                <Field label="Data"><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
              </Grid>
              <Field label="Estoque mínimo (opcional)"><Input inputMode="decimal" value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} /></Field>
              <Checkbox label="Lançar o valor em Gastos" checked={f.lancar} onChange={(v) => setF({ ...f, lancar: v })} />
              {numOuNull(f.valor) && numOuNull(f.quantidade) ? <p className="text-sm text-slate-500">Custo unitário: {brl((numOuNull(f.valor) || 0) / (numOuNull(f.quantidade) || 1))}/{f.unidade} — entra no custo médio.</p> : null}
              <Button type="submit" loading={salvando} className="w-full"><Plus className="h-4 w-4" /> Registrar compra</Button>
            </fieldset>
          </form>
        </Card>
        <Card>
          <CardTitle right={<Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-40" aria-label="Mês" />}>Gastos do mês</CardTitle>
          {!verGastos ? <Aviso>Seu perfil registra compras, mas não consulta os gastos.</Aviso> : falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !dados?.gastos.length ? <Empty texto="Nenhum gasto neste mês" /> : (
            <>
              <Table head={["Data", "Descrição", "Categoria", "Valor", ""]}>
                {dados.gastos.map((g) => (
                  <tr key={g.id}><Td>{data(g.data)}</Td><Td>{g.descricao}</Td><Td><Badge>{CAT_GASTO[g.categoria]}</Badge></Td><Td className="tnum">{brl(g.valor)}</Td>
                    <Td>{app.podeEscrever && <button onClick={() => setExcluir(g)} className="text-slate-400 hover:text-red-600" aria-label="Excluir gasto"><Trash2 className="h-4 w-4" /></button>}</Td></tr>
                ))}
              </Table>
              <div className="mt-3 text-right text-sm font-semibold">Total: {brl(total)}</div>
            </>
          )}
          <p className="mt-4 text-xs text-slate-500">Cadastro de fornecedores, pedidos de compra e conferência de recebimento chegam na Fase 4.</p>
        </Card>
      </div>
      <Confirmar aberto={!!excluir} titulo="Excluir gasto" perigo confirmar="Excluir" onCancel={() => setExcluir(null)}
        onOk={async () => { try { await q(sb().from("gastos").delete().eq("id", excluir!.id)); toast("Gasto excluído"); setExcluir(null); recarregar(); } catch (e) { erro(e); } }}
        texto="Excluir o gasto não mexe no estoque. Se a compra foi lançada errada, estorne também a entrada em Matéria-prima → Movimentações." />
    </>
  );
}
