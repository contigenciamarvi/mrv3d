"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, ArrowDownUp, ClipboardCheck, Undo2, Disc3, Download } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, dataHora, numOuNull, CAT_MATERIA, MATERIAIS_3D, UNIDADES, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Tabs, Kpi, Aviso, Checkbox, Confirmar } from "@/components/ui";

type Mat = {
  id: string; nome: string; codigo: string | null; categoria: string; fabricante: string | null; material: string | null; cor: string | null; diametro: number | null;
  unidade: string; peso_liquido_g: number | null; peso_carretel_g: number | null; quantidade: number; quantidade_reservada: number; estoque_minimo: number;
  custo_medio: number; custo_unitario: number | null; fornecedor: string | null; lote: string | null; localizacao: string | null; margem_pct: number | null;
  data_entrada: string | null; ativo: boolean; permite_negativo: boolean;
};
type Mov = { id: string; material_id: string; tipo: string; quantidade: number; custo_unitario: number | null; observacao: string | null; justificativa: string | null;
  estorno_de: string | null; reserva_id: string | null; ordem_id?: string | null; saldo_antes: number | null; saldo_apos: number | null; created_at: string; materiais?: { nome: string; unidade: string; cor: string | null } };
type Bobina = { id: string; material_id: string; codigo: string; peso_inicial_g: number; consumido_g: number; reservado_g: number; saldo_fisico_g: number; disponivel_g: number; lote: string | null; data_abertura: string | null; ativa: boolean };
type Reserva = { id: string; material_id: string; quantidade: number; referencia: string | null; status: string; created_at: string; bobina_id: string | null };
type Aba = "itens" | "movimentacoes" | "reposicao" | "bobinas" | "reservas";
const disp = (m: Mat) => m.quantidade - m.quantidade_reservada;
const vazio = { nome: "", codigo: "", categoria: "filamento", fabricante: "", material: "PLA", cor: "", diametro: "1,75", unidade: "kg", peso_liquido_g: "", peso_carretel_g: "",
  estoque_minimo: "", fornecedor: "", lote: "", localizacao: "", margem_pct: "", data_entrada: "", quantidade_inicial: "", custo_unitario: "" };

export default function MateriaPrima() { return <Exige perm="materia_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const podeEditar = app.pode("materia_editar") && app.podeEscrever;
  const podeMov = app.pode("materia_movimentar") && app.podeEscrever;
  const verCusto = app.pode("custos_ver");
  const abaUrl = useParam("aba"); const idUrl = useParam("id");
  const [aba, setAba] = useState<Aba>("itens");
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [inativos, setInativos] = useState(false);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [mov, setMov] = useState<{ m: Mat; tipo: string; quantidade: string; custo: string; justificativa: string } | null>(null);
  const [inv, setInv] = useState<{ m: Mat; contagem: string; justificativa: string } | null>(null);
  const [estorno, setEstorno] = useState<{ mv: Mov; motivo: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (abaUrl) setAba(abaUrl as Aba); }, [abaUrl]);
  useEffect(() => { if (idUrl) setBusca(""); }, [idUrl]);

  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [mats, movs, bobinas, reservas] = await Promise.all([
      q<Mat[]>(sb().from("materiais").select("*").eq("empresa_id", app.empresa.id).order("nome").limit(5000)),
      q<Mov[]>(sb().from("movimentacoes_estoque").select("*, materiais(nome,unidade,cor)").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(500)),
      q<Bobina[]>(sb().from("material_bobinas").select("*").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(1000)),
      q<Reserva[]>(sb().from("reservas_materia_prima").select("*").eq("empresa_id", app.empresa.id).eq("status", "ativa").order("created_at", { ascending: false })),
    ]);
    return { mats, movs, bobinas, reservas };
  }, [app.empresa.id]);

  const porId = useMemo(() => Object.fromEntries((dados?.mats || []).map((m) => [m.id, m])), [dados]);
  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (dados?.mats || []).filter((m) => m.ativo !== inativos && (!categoria || m.categoria === categoria) && (!idUrl || m.id === idUrl || t) &&
      (!t || [m.nome, m.codigo, m.cor, m.material, m.fornecedor, m.lote].some((v) => v?.toLowerCase().includes(t))));
  }, [dados, busca, categoria, inativos, idUrl]);
  const reposicao = (dados?.mats || []).filter((m) => m.ativo && m.estoque_minimo > 0 && disp(m) <= m.estoque_minimo);
  const estornadas = new Set((dados?.movs || []).filter((m) => m.estorno_de).map((m) => m.estorno_de));
  const valorEstoque = (dados?.mats || []).filter((m) => m.ativo).reduce((s, m) => s + m.quantidade * m.custo_medio, 0);

  const abrir = (m?: Mat) => {
    setEditId(m?.id || null);
    if (!m) { setForm({ ...vazio, data_entrada: new Date().toISOString().slice(0, 10) }); return; }
    setForm(Object.fromEntries(Object.keys(vazio).map((k) => {
      const v = (m as unknown as Record<string, unknown>)[k];
      return [k, v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v)];
    })));
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setSalvando(true);
    try {
      const dadosReg = { ...form, diametro: numOuNull(form.diametro)?.toString() || "", peso_liquido_g: numOuNull(form.peso_liquido_g)?.toString() || "",
        peso_carretel_g: numOuNull(form.peso_carretel_g)?.toString() || "", estoque_minimo: numOuNull(form.estoque_minimo)?.toString() || "0", margem_pct: numOuNull(form.margem_pct)?.toString() || "" };
      if (editId) {
        await q(sb().from("materiais").update({
          nome: form.nome.trim(), codigo: form.codigo || null, categoria: form.categoria, fabricante: form.fabricante || null, material: form.material || null, cor: form.cor || null,
          diametro: numOuNull(form.diametro), unidade: form.unidade, peso_liquido_g: numOuNull(form.peso_liquido_g), peso_carretel_g: numOuNull(form.peso_carretel_g),
          estoque_minimo: numOuNull(form.estoque_minimo) ?? 0, fornecedor: form.fornecedor || null, lote: form.lote || null, localizacao: form.localizacao || null,
          margem_pct: numOuNull(form.margem_pct), data_entrada: form.data_entrada || null,
        }).eq("id", editId));
      } else {
        await rpc("cadastrar_materia_prima", { p_empresa: app.empresa.id, p_dados: dadosReg, p_quantidade_inicial: numOuNull(form.quantidade_inicial) || 0, p_custo_unitario: numOuNull(form.custo_unitario) });
      }
      toast("Matéria-prima salva"); setForm(null); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const movimentar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!mov) return; setSalvando(true);
    try {
      const r = await rpc<{ saldo: number }>("movimentar_materia_prima", { p_material: mov.m.id, p_tipo: mov.tipo, p_quantidade: numOuNull(mov.quantidade), p_custo_unitario: numOuNull(mov.custo), p_justificativa: mov.justificativa || null });
      toast(`Saldo de ${mov.m.nome}: ${num(r.saldo)} ${mov.m.unidade}`); setMov(null); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const inventariar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!inv) return; setSalvando(true);
    try { await rpc("inventariar_materia_prima", { p_material: inv.m.id, p_contagem: numOuNull(inv.contagem), p_justificativa: inv.justificativa }); toast("Inventário registrado"); setInv(null); recarregar(); }
    catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const estornar = async () => {
    if (!estorno) return; setSalvando(true);
    try { await rpc("estornar_movimentacao", { p_mov: estorno.mv.id, p_motivo: estorno.motivo }); toast("Estorno lançado"); setEstorno(null); recarregar(); }
    catch (e) { erro(e); } finally { setSalvando(false); }
  };
  const ativarDesativar = async (m: Mat) => {
    try { await q(sb().from("materiais").update({ ativo: !m.ativo }).eq("id", m.id)); toast(m.ativo ? "Item desativado" : "Item reativado"); recarregar(); } catch (e) { erro(e); }
  };
  const exportarReposicao = () => {
    const linhas = [["Item", "Código", "Disponível", "Unidade", "Mínimo", "Sugestão de compra", "Fornecedor"],
      ...reposicao.map((m) => [m.nome, m.codigo || "", String(disp(m)), m.unidade, String(m.estoque_minimo), String(Math.max(m.estoque_minimo * 2 - disp(m), 0)), m.fornecedor || ""])];
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "lista-de-reposicao.csv"; a.click();
  };

  return (
    <>
      <PageHeader titulo="MATÉRIA-PRIMA" sub="Filamentos, resinas, consumíveis, componentes e embalagens"
        acoes={podeEditar && <Button onClick={() => abrir()}><Plus className="h-4 w-4" /> Nova matéria-prima</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Itens ativos" valor={(dados?.mats || []).filter((m) => m.ativo).length} />
        <Kpi label="Abaixo do mínimo" valor={reposicao.length} tom={reposicao.length ? "vermelho" : undefined} />
        <Kpi label="Reservas ativas" valor={dados?.reservas.length || 0} />
        {verCusto && <Kpi label="Estoque valorizado" valor={brl(valorEstoque)} sub="Saldo físico × custo médio" />}
      </div>
      <Tabs abas={[["itens", "Itens"], ["movimentacoes", "Movimentações"], ["reposicao", `Reposição (${reposicao.length})`], ["bobinas", "Bobinas"], ["reservas", "Reservas"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : (
        <Card>
          {aba === "itens" && <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Input placeholder="Buscar por nome, código, cor, lote ou fornecedor" value={busca} onChange={(e) => setBusca(e.target.value)} className="min-w-60 flex-1" aria-label="Buscar" />
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-48" aria-label="Categoria"><option value="">Todas as categorias</option>{Object.entries(CAT_MATERIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Select value={inativos ? "1" : "0"} onChange={(e) => setInativos(e.target.value === "1")} className="w-32" aria-label="Situação"><option value="0">Ativos</option><option value="1">Inativos</option></Select>
            </div>
            {itens.length === 0 ? <Empty texto="Nenhum item" /> : (
              <Table head={["Item", "Categoria", "Físico", "Reservado", "Disponível", verCusto ? "Custo médio" : "", ""]}>
                {itens.map((m) => (
                  <tr key={m.id} className={cn(m.estoque_minimo > 0 && disp(m) <= m.estoque_minimo && "bg-red-50/60 dark:bg-red-950/20")}>
                    <Td><div className="font-medium">{m.nome}{m.codigo && <span className="ml-2 text-xs text-slate-400">{m.codigo}</span>}</div>
                      <div className="text-xs text-slate-500">{[m.material, m.cor, m.diametro && `${num(m.diametro)} mm`, m.fabricante, m.lote && `lote ${m.lote}`, m.localizacao].filter(Boolean).join(" · ")}</div></Td>
                    <Td>{CAT_MATERIA[m.categoria]}</Td>
                    <Td className="tnum">{num(m.quantidade)} {m.unidade}</Td>
                    <Td className="tnum text-slate-500">{m.quantidade_reservada > 0 ? `${num(m.quantidade_reservada)} ${m.unidade}` : "—"}</Td>
                    <Td className="tnum font-medium">{num(disp(m))} {m.unidade}{m.estoque_minimo > 0 && disp(m) <= m.estoque_minimo && <Badge tom="vermelho">abaixo do mínimo</Badge>}</Td>
                    <Td className="tnum">{verCusto ? `${brl(m.custo_medio)}/${m.unidade}` : ""}</Td>
                    <Td><div className="flex justify-end gap-1">
                      {podeMov && m.ativo && <button title="Entrada / saída / ajuste" onClick={() => setMov({ m, tipo: "entrada", quantidade: "", custo: m.custo_medio ? String(m.custo_medio).replace(".", ",") : "", justificativa: "" })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Movimentar"><ArrowDownUp className="h-4 w-4" /></button>}
                      {podeMov && m.ativo && <button title="Inventário" onClick={() => setInv({ m, contagem: "", justificativa: "Inventário" })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Inventário"><ClipboardCheck className="h-4 w-4" /></button>}
                      {podeEditar && <button title="Editar" onClick={() => abrir(m)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>}
                    </div></Td>
                  </tr>
                ))}
              </Table>
            )}
          </>}

          {aba === "movimentacoes" && ((dados?.movs.length || 0) === 0 ? <Empty texto="Nenhuma movimentação" /> : (
            <Table head={["Quando", "Item", "Tipo", "Quantidade", "Saldo", "Motivo", ""]}>
              {dados!.movs.map((mv) => (
                <tr key={mv.id}>
                  <Td className="whitespace-nowrap">{dataHora(mv.created_at)}</Td>
                  <Td>{mv.materiais?.nome}{mv.materiais?.cor && ` · ${mv.materiais.cor}`}</Td>
                  <Td><Badge tom={mv.estorno_de ? "amarelo" : mv.tipo === "entrada" ? "verde" : mv.tipo === "saida" ? "vermelho" : "azul"}>{mv.estorno_de ? "Estorno" : mv.tipo === "entrada" ? "Entrada" : mv.tipo === "saida" ? "Saída" : "Ajuste"}</Badge>{estornadas.has(mv.id) && <span className="ml-1 text-xs text-slate-400">(estornada)</span>}</Td>
                  <Td className="tnum">{mv.tipo === "saida" ? "−" : mv.tipo === "entrada" ? "+" : "="}{num(mv.quantidade)} {mv.materiais?.unidade}{verCusto && mv.custo_unitario != null && <div className="text-xs text-slate-500">{brl(mv.custo_unitario)}/un</div>}</Td>
                  <Td className="tnum text-slate-500">{mv.saldo_antes != null ? `${num(mv.saldo_antes)} → ${num(mv.saldo_apos)}` : "—"}</Td>
                  <Td className="max-w-64 text-slate-600 dark:text-slate-300">{[mv.observacao, mv.justificativa].filter(Boolean).join(" — ")}</Td>
                  <Td>{podeMov && !mv.estorno_de && !mv.reserva_id && !mv.ordem_id && !estornadas.has(mv.id) && (
                    <button onClick={() => setEstorno({ mv, motivo: "" })} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Undo2 className="h-3 w-3" /> Estornar</button>)}</Td>
                </tr>
              ))}
            </Table>
          ))}

          {aba === "reposicao" && (reposicao.length === 0 ? <Empty texto="Tudo acima do estoque mínimo" /> : <>
            <div className="mb-3 flex justify-end"><Button size="sm" variant="secondary" onClick={exportarReposicao}><Download className="h-4 w-4" /> Exportar CSV</Button></div>
            <Table head={["Item", "Disponível", "Mínimo", "Sugestão de compra", "Fornecedor", verCusto ? "Valor estimado" : ""]}>
              {reposicao.map((m) => { const sug = Math.max(m.estoque_minimo * 2 - disp(m), 0); return (
                <tr key={m.id}><Td className="font-medium">{m.nome}</Td><Td className="tnum text-red-600">{num(disp(m))} {m.unidade}</Td><Td className="tnum">{num(m.estoque_minimo)} {m.unidade}</Td>
                  <Td className="tnum font-medium">{num(sug)} {m.unidade}</Td><Td>{m.fornecedor || "—"}</Td><Td className="tnum">{verCusto ? brl(sug * m.custo_medio) : ""}</Td></tr>); })}
            </Table>
            <p className="mt-3 text-xs text-slate-500">Sugestão = o dobro do mínimo menos o disponível.</p>
          </>)}

          {aba === "bobinas" && <Bobinas mats={(dados?.mats || []).filter((m) => m.ativo)} bobinas={dados?.bobinas || []} porId={porId} podeEditar={podeEditar} podeMov={podeMov} onMudou={recarregar} />}

          {aba === "reservas" && ((dados?.reservas.length || 0) === 0 ? <Empty texto="Nenhuma reserva ativa" /> : (
            <Table head={["Quando", "Item", "Quantidade", "Referência", ""]}>
              {dados!.reservas.map((r) => (
                <tr key={r.id}><Td>{dataHora(r.created_at)}</Td><Td>{porId[r.material_id]?.nome}</Td><Td className="tnum">{num(r.quantidade)} {porId[r.material_id]?.unidade}</Td><Td>{r.referencia || "—"}</Td>
                  <Td>{podeMov && <div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={async () => { const real = prompt(`Quantidade realmente consumida (${porId[r.material_id]?.unidade})`, String(r.quantidade)); if (real == null) return; try { await rpc("consumir_reserva", { p_reserva: r.id, p_quantidade_real: numOuNull(real) }); toast("Consumo registrado"); recarregar(); } catch (e) { erro(e); } }}>Consumir</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { try { await rpc("liberar_reserva", { p_reserva: r.id }); toast("Reserva liberada"); recarregar(); } catch (e) { erro(e); } }}>Liberar</Button>
                  </div>}</Td></tr>
              ))}
            </Table>
          ))}
        </Card>
      )}

      <Modal aberto={!!form} titulo={editId ? "Editar matéria-prima" : "Nova matéria-prima"} onClose={() => setForm(null)} largura="max-w-3xl">
        {form && <form onSubmit={salvar} className="space-y-3">
          <Grid cols={3}>
            <Field label="Nome"><Input required maxLength={200} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="PLA Preto Voolt" /></Field>
            <Field label="Código interno"><Input maxLength={40} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="PLA-PT-01" /></Field>
            <Field label="Categoria"><Select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>{Object.entries(CAT_MATERIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Material"><Input list="mat3d" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} /></Field>
            <Field label="Cor"><Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} /></Field>
            <Field label="Fabricante"><Input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })} /></Field>
            <Field label="Unidade de medida" hint={editId ? "Mudar a unidade não converte o saldo" : undefined}><Select value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</Select></Field>
            {form.categoria === "filamento" && <Field label="Diâmetro (mm)"><Input inputMode="decimal" value={form.diametro} onChange={(e) => setForm({ ...form, diametro: e.target.value })} /></Field>}
            <Field label="Peso líquido (g)" hint="Por bobina/unidade"><Input inputMode="decimal" value={form.peso_liquido_g} onChange={(e) => setForm({ ...form, peso_liquido_g: e.target.value })} placeholder="1000" /></Field>
            <Field label="Peso da bobina vazia (g)"><Input inputMode="decimal" value={form.peso_carretel_g} onChange={(e) => setForm({ ...form, peso_carretel_g: e.target.value })} /></Field>
            <Field label="Estoque mínimo"><Input inputMode="decimal" value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })} /></Field>
            {(app.pode("descontos_aprovar") || app.pode("config_editar")) && <Field label="Margem especial (%)" hint="Opcional, para orçamentos"><Input inputMode="decimal" value={form.margem_pct} onChange={(e) => setForm({ ...form, margem_pct: e.target.value })} /></Field>}
            <Field label="Fornecedor"><Input value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} /></Field>
            <Field label="Lote"><Input value={form.lote} onChange={(e) => setForm({ ...form, lote: e.target.value })} /></Field>
            <Field label="Localização"><Input value={form.localizacao} onChange={(e) => setForm({ ...form, localizacao: e.target.value })} placeholder="Prateleira A2" /></Field>
            <Field label="Data de entrada"><Input type="date" value={form.data_entrada} onChange={(e) => setForm({ ...form, data_entrada: e.target.value })} /></Field>
          </Grid>
          <datalist id="mat3d">{MATERIAIS_3D.map((m) => <option key={m} value={m} />)}</datalist>
          {!editId && <Grid>
            <Field label={`Quantidade inicial (${form.unidade})`}><Input inputMode="decimal" value={form.quantidade_inicial} onChange={(e) => setForm({ ...form, quantidade_inicial: e.target.value })} placeholder="0" /></Field>
            <Field label={`Custo de aquisição por ${form.unidade} (R$)`}><Input inputMode="decimal" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })} /></Field>
          </Grid>}
          {editId && <Aviso>Saldo e custo médio só mudam por entrada, saída, ajuste ou inventário — assim o histórico fica completo.</Aviso>}
          {editId && <Checkbox label="Item ativo" checked={(dados?.mats.find((m) => m.id === editId)?.ativo) ?? true} onChange={() => { const m = dados?.mats.find((x) => x.id === editId); if (m) { ativarDesativar(m); setForm(null); } }} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Salvar</Button></div>
        </form>}
      </Modal>

      <Modal aberto={!!mov} titulo={`Movimentar · ${mov?.m.nome}`} onClose={() => setMov(null)}>
        {mov && <form onSubmit={movimentar} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">{[["entrada", "Entrada"], ["saida", "Saída"], ["ajuste", "Ajuste"]].map(([k, v]) => (
            <button key={k} type="button" onClick={() => setMov({ ...mov, tipo: k })} className={cn("h-10 rounded-lg border text-sm font-medium", mov.tipo === k ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700")}>{v}</button>))}</div>
          <p className="text-sm text-slate-500">Físico: {num(mov.m.quantidade)} {mov.m.unidade} · disponível: {num(disp(mov.m))} {mov.m.unidade}</p>
          <Field label={mov.tipo === "ajuste" ? `Novo saldo físico (${mov.m.unidade})` : `Quantidade (${mov.m.unidade})`}><Input required inputMode="decimal" autoFocus value={mov.quantidade} onChange={(e) => setMov({ ...mov, quantidade: e.target.value })} /></Field>
          {mov.tipo === "entrada" && (verCusto || app.pode("compras_gerenciar")) && <Field label={`Custo por ${mov.m.unidade} (R$)`} hint="Atualiza o custo médio ponderado"><Input inputMode="decimal" value={mov.custo} onChange={(e) => setMov({ ...mov, custo: e.target.value })} /></Field>}
          <Field label={mov.tipo === "ajuste" ? "Justificativa (obrigatória)" : "Observação"}><Textarea required={mov.tipo === "ajuste"} minLength={mov.tipo === "ajuste" ? 3 : undefined} value={mov.justificativa} onChange={(e) => setMov({ ...mov, justificativa: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setMov(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Registrar</Button></div>
        </form>}
      </Modal>
      <Modal aberto={!!inv} titulo={`Inventário · ${inv?.m.nome}`} onClose={() => setInv(null)}>
        {inv && <form onSubmit={inventariar} className="space-y-3">
          <p className="text-sm text-slate-500">O sistema registra {num(inv.m.quantidade)} {inv.m.unidade}. Informe quanto há fisicamente; a diferença vira um ajuste no histórico.</p>
          <Field label={`Contagem física (${inv.m.unidade})`}><Input required inputMode="decimal" autoFocus value={inv.contagem} onChange={(e) => setInv({ ...inv, contagem: e.target.value })} /></Field>
          {numOuNull(inv.contagem) != null && <Aviso tom={numOuNull(inv.contagem)! < inv.m.quantidade ? "amarelo" : "azul"}>Diferença: {num(numOuNull(inv.contagem)! - inv.m.quantidade)} {inv.m.unidade}</Aviso>}
          <Field label="Justificativa"><Input required minLength={3} value={inv.justificativa} onChange={(e) => setInv({ ...inv, justificativa: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setInv(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Registrar inventário</Button></div>
        </form>}
      </Modal>
      <Confirmar aberto={!!estorno} titulo="Estornar movimentação" confirmar="Estornar" carregando={salvando} onCancel={() => setEstorno(null)} onOk={estornar}
        texto="O estorno lança a movimentação inversa e fica registrado no histórico. Cada movimentação só pode ser estornada uma vez.">
        {estorno && <div className="mt-3"><Field label="Motivo"><Input required value={estorno.motivo} onChange={(e) => setEstorno({ ...estorno, motivo: e.target.value })} /></Field></div>}
      </Confirmar>
    </>
  );
}

function Bobinas({ mats, bobinas, porId, podeEditar, podeMov, onMudou }: { mats: Mat[]; bobinas: Bobina[]; porId: Record<string, Mat>; podeEditar: boolean; podeMov: boolean; onMudou: () => void }) {
  const app = useApp();
  const [nova, setNova] = useState<{ material_id: string; codigo: string; peso: string; lote: string } | null>(null);
  const [consumo, setConsumo] = useState<{ b: Bobina; gramas: string; obs: string } | null>(null);
  const comBobina = mats.filter((m) => ["filamento", "resina"].includes(m.categoria));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Acompanhe cada bobina: peso inicial, consumo e reserva. O consumo baixa automaticamente o estoque do material.</p>
        {podeEditar && <Button size="sm" disabled={!comBobina.length} onClick={() => setNova({ material_id: comBobina[0]?.id || "", codigo: String(bobinas.length + 1).padStart(3, "0"), peso: String(comBobina[0]?.peso_liquido_g || 1000), lote: "" })}><Disc3 className="h-4 w-4" /> Nova bobina</Button>}
      </div>
      {bobinas.length === 0 ? <Empty texto="Nenhuma bobina registrada" /> : (
        <Table head={["Bobina", "Inicial", "Consumido", "Reservado", "Saldo físico", "Disponível", ""]}>
          {bobinas.map((b) => (
            <tr key={b.id}><Td><div className="font-medium">{porId[b.material_id]?.nome} — {b.codigo}</div>{b.lote && <div className="text-xs text-slate-500">lote {b.lote}</div>}</Td>
              <Td className="tnum">{num(b.peso_inicial_g, 0)} g</Td><Td className="tnum">{num(b.consumido_g, 0)} g</Td><Td className="tnum">{num(b.reservado_g, 0)} g</Td>
              <Td className="tnum">{num(b.saldo_fisico_g, 0)} g</Td>
              <Td><div className="tnum font-medium">{num(b.disponivel_g, 0)} g</div><div className="mt-1 h-1.5 w-24 rounded bg-slate-200 dark:bg-slate-700"><div className="h-1.5 rounded bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, (b.disponivel_g / b.peso_inicial_g) * 100))}%` }} /></div></Td>
              <Td>{podeMov && b.disponivel_g > 0 && <Button size="sm" variant="secondary" onClick={() => setConsumo({ b, gramas: "", obs: "" })}>Registrar consumo</Button>}</Td></tr>
          ))}
        </Table>
      )}
      <Modal aberto={!!nova} titulo="Nova bobina" onClose={() => setNova(null)}>
        {nova && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await q(sb().from("material_bobinas").insert({ empresa_id: app.empresa.id, material_id: nova.material_id, codigo: nova.codigo, peso_inicial_g: numOuNull(nova.peso), lote: nova.lote || null, data_abertura: new Date().toISOString().slice(0, 10) })); toast("Bobina registrada"); setNova(null); onMudou(); } catch (e2) { erro(e2); } }}>
          <Field label="Material"><Select value={nova.material_id} onChange={(e) => setNova({ ...nova, material_id: e.target.value })}>{comBobina.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field>
          <Grid><Field label="Identificação"><Input required value={nova.codigo} onChange={(e) => setNova({ ...nova, codigo: e.target.value })} /></Field>
            <Field label="Peso inicial (g)"><Input required inputMode="decimal" value={nova.peso} onChange={(e) => setNova({ ...nova, peso: e.target.value })} /></Field></Grid>
          <Field label="Lote"><Input value={nova.lote} onChange={(e) => setNova({ ...nova, lote: e.target.value })} /></Field>
          <Aviso>A bobina é um controle detalhado: lance a entrada do material normalmente (em Itens) e use as bobinas para saber quanto sobra em cada uma.</Aviso>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNova(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>
      <Modal aberto={!!consumo} titulo={`Consumo · bobina ${consumo?.b.codigo}`} onClose={() => setConsumo(null)}>
        {consumo && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await rpc("consumir_bobina", { p_bobina: consumo.b.id, p_gramas: numOuNull(consumo.gramas), p_observacao: consumo.obs || null }); toast("Consumo registrado"); setConsumo(null); onMudou(); } catch (e2) { erro(e2); } }}>
          <p className="text-sm text-slate-500">Disponível: {num(consumo.b.disponivel_g, 0)} g</p>
          <Field label="Gramas consumidos"><Input required autoFocus inputMode="decimal" value={consumo.gramas} onChange={(e) => setConsumo({ ...consumo, gramas: e.target.value })} /></Field>
          <Field label="Observação"><Input value={consumo.obs} onChange={(e) => setConsumo({ ...consumo, obs: e.target.value })} placeholder="Peça, pedido…" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConsumo(null)}>Cancelar</Button><Button type="submit">Registrar</Button></div>
        </form>}
      </Modal>
    </>
  );
}
