"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Send, Check, X, Copy, Printer, ShoppingCart, Ban, Upload, MessageCircle, History, ChevronDown, ChevronUp, Link2, Box } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, enviarArquivo } from "@/lib/supabase";
import { useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, hojeISO, numOuNull, linkWhats, preencher, STATUS_ORCAMENTO, TECNOLOGIAS, cn } from "@/lib/utils";
import { analisarModelo, densidadeDe, type Analise } from "@/lib/modelo3d";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, Badge, tomStatus, Aviso, Confirmar } from "@/components/ui";

type Mat = { id: string; nome: string; material: string | null; cor: string | null; unidade: string; custo_medio: number; peso_liquido_g: number | null; margem_pct: number | null };
type Imp = { id: string; nome: string; tecnologia: string; potencia_w: number; custo_hora: number };
type Prod = { id: string; nome: string; material_id: string | null; cor: string | null; peso_g: number | null; tempo_h: number | null; impressora_id: string | null; margem_pct: number | null; preco_venda: number };
type Cli = { id: string; nome: string; whatsapp: string | null; telefone: string | null; margem_pct: number | null };
type Item = Record<string, string> & { _id?: string; _key: string };
const CAMPOS_ITEM = ["produto_id", "descricao", "tecnologia", "impressora_id", "material_id", "cor", "quantidade", "peso_g", "tempo_h", "desperdicio_pct", "suportes_custo", "mao_obra_h",
  "acabamento_custo", "pintura_custo", "embalagem_custo", "frete_assumido", "outros_custos", "desconto_terceiros", "margem_pct", "impostos_pct", "taxas_pct", "preco_manual", "arquivo_path", "arquivo_nome", "volume_cm3"];
const NUM_ITEM = ["quantidade", "peso_g", "tempo_h", "desperdicio_pct", "suportes_custo", "mao_obra_h", "acabamento_custo", "pintura_custo", "embalagem_custo", "frete_assumido",
  "outros_custos", "desconto_terceiros", "margem_pct", "impostos_pct", "taxas_pct", "preco_manual", "volume_cm3"];
const NULAVEIS = ["desperdicio_pct", "margem_pct", "impostos_pct", "taxas_pct", "preco_manual", "volume_cm3"];
const novaChave = () => Math.random().toString(36).slice(2);
const fmt = (v: unknown) => (v == null ? "" : String(v).replace(".", ","));
const CONGELADOS = ["aprovado", "convertido", "cancelado"];

export default function EditarOrcamento() { return <Exige perm={["orcamentos_ver", "orcamentos_criar"]}><Editor /></Exige>; }

function Editor() {
  const app = useApp();
  const router = useRouter();
  const idUrl = useParam("id");
  const clienteUrl = useParam("cliente");
  const [id, setId] = useState<string | null>(null);
  const [base, setBase] = useState<{ mats: Mat[]; imps: Imp[]; prods: Prod[]; clis: Cli[] } | null>(null);
  const [cab, setCab] = useState<Record<string, string>>({ cliente_id: "", titulo: "", descricao: "", validade: "", prazo_entrega_dias: String(app.config.prazo_padrao_dias), desconto_valor: "", frete_cobrado: "", observacoes: "", condicoes: "" });
  const [orc, setOrc] = useState<Record<string, unknown> | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [salvos, setSalvos] = useState<Record<string, Record<string, number>>>({});
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [dialogo, setDialogo] = useState<null | "enviado" | "aprovar" | "rejeitar" | "cancelar" | "converter" | "revisoes" | "cliente">(null);
  const [motivo, setMotivo] = useState("");
  const [revisoes, setRevisoes] = useState<{ id: number; revisao: number; evento: string; created_at: string; dados: { orcamento: { total: number } } }[]>([]);
  const [novoCli, setNovoCli] = useState({ nome: "", whatsapp: "" });

  const status = (orc?.status as string) || "rascunho";
  const congelado = CONGELADOS.includes(status);
  const pode = app.pode("orcamentos_criar") && app.podeEscrever && !congelado;
  const verCusto = app.pode("custos_ver") || app.pode("orcamentos_criar");
  const expirado = status === "enviado" && !!orc?.validade && (orc.validade as string) < hojeISO();

  const carregar = useCallback(async (oid: string | null) => {
    setCarregando(true);
    try {
      const [mats, imps, prods, clis] = await Promise.all([
        q<Mat[]>(sb().from("materiais").select("id,nome,material,cor,unidade,custo_medio,peso_liquido_g,margem_pct").eq("empresa_id", app.empresa.id).eq("ativo", true).in("categoria", ["filamento", "resina", "outro", "consumivel"]).order("nome")),
        q<Imp[]>(sb().from("impressoras").select("id,nome,tecnologia,potencia_w,custo_hora").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")),
        q<Prod[]>(sb().from("produtos").select("id,nome,material_id,cor,peso_g,tempo_h,impressora_id,margem_pct,preco_venda").eq("empresa_id", app.empresa.id).eq("status", "ativo").order("nome")),
        q<Cli[]>(sb().from("clientes").select("id,nome,whatsapp,telefone,margem_pct").eq("empresa_id", app.empresa.id).eq("arquivado", false).order("nome").limit(5000)),
      ]);
      setBase({ mats, imps, prods, clis });
      if (oid) {
        const o = await q<Record<string, unknown>>(sb().from("orcamentos").select("*").eq("id", oid).single());
        const its = await q<Record<string, unknown>[]>(sb().from("orcamento_itens").select("*").eq("orcamento_id", oid).order("ordem").order("created_at"));
        setOrc(o); setId(oid);
        setCab({ cliente_id: (o.cliente_id as string) || "", titulo: o.titulo as string, descricao: (o.descricao as string) || "", validade: (o.validade as string) || "",
          prazo_entrega_dias: fmt(o.prazo_entrega_dias), desconto_valor: fmt(o.desconto_valor), frete_cobrado: fmt(o.frete_cobrado), observacoes: (o.observacoes as string) || "", condicoes: (o.condicoes as string) || "" });
        setItens(its.map((i) => ({ _id: i.id as string, _key: i.id as string, ...Object.fromEntries(CAMPOS_ITEM.map((k) => [k, fmt(i[k])])) } as Item)));
        setSalvos(Object.fromEntries(its.map((i) => [i.id as string, i as Record<string, number>])));
        setRemovidos([]);
      } else {
        setItens([itemVazio()]); setAberto(null);
      }
    } catch (e) { erro(e); } finally { setCarregando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.empresa.id]);

  useEffect(() => { carregar(idUrl); }, [idUrl, carregar]);
  useEffect(() => { if (clienteUrl && !idUrl) setCab((c) => ({ ...c, cliente_id: clienteUrl })); }, [clienteUrl, idUrl]);

  function itemVazio(): Item {
    const k = novaChave();
    setAberto(k);
    return { _key: k, ...Object.fromEntries(CAMPOS_ITEM.map((c) => [c, ""])), tecnologia: "fdm", quantidade: "1", embalagem_custo: fmt(app.config.embalagem_padrao || "") } as Item;
  }
  const setItem = (key: string, patch: Partial<Item>) => setItens((l) => l.map((i) => (i._key === key ? { ...i, ...patch } as Item : i)));
  const escolherProduto = (it: Item, pid: string) => {
    const p = base?.prods.find((x) => x.id === pid);
    if (!p) { setItem(it._key, { produto_id: "" }); return; }
    setItem(it._key, { produto_id: pid, descricao: it.descricao || p.nome, material_id: p.material_id || it.material_id, cor: p.cor || it.cor,
      peso_g: fmt(p.peso_g ?? it.peso_g), tempo_h: fmt(p.tempo_h ?? it.tempo_h), impressora_id: p.impressora_id || it.impressora_id });
  };

  // ---- prévia do cálculo (mesmas fórmulas do servidor; o valor oficial é o salvo) ----
  const calc = useCallback((it: Item) => {
    const n = (k: string) => numOuNull(it[k]) ?? 0;
    const m = base?.mats.find((x) => x.id === it.material_id);
    const imp = base?.imps.find((x) => x.id === it.impressora_id);
    const cli = base?.clis.find((x) => x.id === cab.cliente_id);
    const pr = base?.prods.find((x) => x.id === it.produto_id);
    const fator = m ? ({ kg: 1000, g: 1, l: 1000, ml: 1 } as Record<string, number>)[m.unidade] ?? (m.peso_liquido_g || 0) : 0;
    const precoKg = m ? (fator > 0 ? (m.custo_medio / fator) * 1000 : m.custo_medio) : 0;
    const margem = numOuNull(it.margem_pct) ?? cli?.margem_pct ?? pr?.margem_pct ?? m?.margem_pct ?? app.config.margem_pct;
    const impostos = numOuNull(it.impostos_pct) ?? app.config.impostos_pct;
    const taxas = numOuNull(it.taxas_pct) ?? app.config.taxas_pct;
    const desp = numOuNull(it.desperdicio_pct) ?? app.config.desperdicio_pct;
    // outros filamentos do item (peças multicoloridas importadas do Bambu Studio): preço/kg congelado no item
    const extras = ((it._id && (salvos[it._id] as unknown as { filamentos_extras?: { peso_g: number; preco_kg: number }[] })?.filamentos_extras) || [])
      .reduce((t, e) => t + (Number(e.peso_g) / 1000) * Number(e.preco_kg || 0), 0);
    const material = ((n("peso_g") / 1000) * precoKg + extras) * (1 + desp / 100);
    const energia = ((imp?.potencia_w || 0) / 1000) * n("tempo_h") * app.config.energia_kwh;
    const maquina = n("tempo_h") * (imp?.custo_hora || 0);
    const maoObra = n("mao_obra_h") * app.config.mao_obra_hora;
    const direto = material + energia + maquina + maoObra + n("suportes_custo") + n("acabamento_custo") + n("pintura_custo") + n("embalagem_custo") + n("outros_custos");
    const cf = app.config;
    const falha = cf.falha_metodo === "percentual" ? direto * (cf.falha_pct || 0) / 100 : cf.falha_metodo === "sucesso" ? (material + energia + maquina) * (100 / Math.max(cf.taxa_sucesso_pct || 100, 1) - 1) : 0;
    const custo = direto + falha + n("frete_assumido");
    const fixo = (cf.horas_produtivas_mes || 0) > 0 ? n("tempo_h") * cf.custos_fixos_mensais / (cf.horas_produtivas_mes || 1) : 0;
    const den = 1 - (margem + impostos + taxas) / 100;
    const preco = numOuNull(it.preco_manual) ?? (den > 0 ? Math.round(((custo + fixo - n("desconto_terceiros")) / den) * 100) / 100 : NaN);
    const qtd = n("quantidade") || 0;
    const total = Math.round(preco * qtd * 100) / 100;
    const custoTotal = (custo - n("desconto_terceiros")) * qtd;
    const lucro = total - custoTotal - total * (impostos + taxas) / 100;
    return { material, energia, maquina, maoObra, custo, preco, total, custoTotal, lucro, margem, impostos, taxas, desp, precoKg, den, imp, m };
  }, [base, cab.cliente_id, app.config, salvos]);

  const resumo = useMemo(() => {
    const cs = itens.map((it) => (congelado && it._id && salvos[it._id] ? {
      total: Number(salvos[it._id].preco_total), custoTotal: Number(salvos[it._id].custo_total), lucro: Number(salvos[it._id].lucro) } : calc(it)));
    const subtotal = cs.reduce((s, c) => s + (c.total || 0), 0);
    const desconto = numOuNull(cab.desconto_valor) || 0, frete = numOuNull(cab.frete_cobrado) || 0;
    return { subtotal, desconto, frete, total: subtotal - desconto + frete, custo: cs.reduce((s, c) => s + c.custoTotal, 0), lucro: cs.reduce((s, c) => s + c.lucro, 0) - desconto };
  }, [itens, calc, cab, congelado, salvos]);

  const salvar = async (silencioso = false): Promise<string | null> => {
    if (!cab.titulo.trim()) { toast("Dê um título ao orçamento", "erro"); return null; }
    if (!itens.some((i) => i.descricao.trim())) { toast("Adicione pelo menos um item com descrição", "erro"); return null; }
    for (const it of itens) { const c = calc(it); if (!(c.den > 0) && numOuNull(it.preco_manual) == null) { toast(`"${it.descricao || "Item"}": margem + impostos + taxas precisam somar menos de 100%`, "erro"); return null; } }
    setSalvando(true);
    try {
      const reg = { cliente_id: cab.cliente_id || null, titulo: cab.titulo.trim(), descricao: cab.descricao || null, validade: cab.validade || null,
        prazo_entrega_dias: numOuNull(cab.prazo_entrega_dias), frete_cobrado: numOuNull(cab.frete_cobrado) || 0, observacoes: cab.observacoes || null, condicoes: cab.condicoes || null };
      let oid = id;
      if (!oid) {
        const r = await q<{ id: string }>(sb().from("orcamentos").insert({ ...reg, empresa_id: app.empresa.id }).select("id").single());
        oid = r.id; setId(oid);
      } else await q(sb().from("orcamentos").update(reg).eq("id", oid));
      for (const rid of removidos) await q(sb().from("orcamento_itens").delete().eq("id", rid));
      let ordem = 0;
      for (const it of itens.filter((i) => i.descricao.trim())) {
        const r: Record<string, unknown> = { ordem: ordem++ };
        for (const k of CAMPOS_ITEM) {
          if (NUM_ITEM.includes(k)) { const v = numOuNull(it[k]); r[k] = v ?? (NULAVEIS.includes(k) ? null : k === "quantidade" ? 1 : 0); }
          else r[k] = it[k] || null;
        }
        r.tecnologia = it.tecnologia || "fdm";
        if (it._id) await q(sb().from("orcamento_itens").update(r).eq("id", it._id));
        else await q(sb().from("orcamento_itens").insert({ ...r, empresa_id: app.empresa.id, orcamento_id: oid }));
      }
      // desconto por último: o servidor confere o limite com o subtotal já atualizado
      await q(sb().from("orcamentos").update({ desconto_valor: numOuNull(cab.desconto_valor) || 0 }).eq("id", oid));
      if (!silencioso) toast("Orçamento salvo");
      if (!idUrl || idUrl !== oid) router.replace(`/orcamentos/editar/?id=${oid}`);
      await carregar(oid);
      return oid;
    } catch (e) { erro(e); return null; } finally { setSalvando(false); }
  };

  const fluxo = async (acao: "enviar" | "aprovar" | "rejeitar" | "cancelar" | "converter" | "duplicar") => {
    setSalvando(true);
    try {
      let oid = id;
      if (["enviar", "aprovar"].includes(acao) && pode) oid = await salvar(true);
      if (!oid) return;
      if (acao === "enviar") { await rpc("enviar_orcamento", { p_id: oid }); await carregar(oid); setDialogo("enviado"); return; }
      if (acao === "aprovar") await rpc("decidir_orcamento", { p_id: oid, p_aprovar: true, p_motivo: null });
      if (acao === "rejeitar") await rpc("decidir_orcamento", { p_id: oid, p_aprovar: false, p_motivo: motivo });
      if (acao === "cancelar") await rpc("cancelar_orcamento", { p_id: oid });
      if (acao === "converter") { const ped = await rpc<string>("converter_orcamento_em_pedido", { p_id: oid }); toast("Pedido criado!"); router.push(`/pedidos/?id=${ped}`); return; }
      if (acao === "duplicar") { const novo = await rpc<string>("duplicar_orcamento", { p_id: oid }); toast("Cópia criada como rascunho"); router.push(`/orcamentos/editar/?id=${novo}`); return; }
      toast("Orçamento atualizado"); setDialogo(null); setMotivo(""); await carregar(oid);
    } catch (e) { erro(e); } finally { setSalvando(false); }
  };

  const link = orc?.token_publico ? `${typeof window !== "undefined" ? window.location.origin : ""}/orcamento/?t=${orc.token_publico}` : "";
  const cliente = base?.clis.find((c) => c.id === cab.cliente_id);
  const numero = orc ? `${app.config.prefixo_orcamento}-${orc.numero}` : "";
  const msgWhats = preencher(app.config.msg_orcamento, { cliente: cliente?.nome.split(" ")[0] || "", numero, empresa: app.empresa.nome, total: brl(orc?.total as number), link });

  if (carregando && !base) return <Loading />;
  return (
    <>
      <PageHeader titulo={id ? `Orçamento ${numero}` : "Novo orçamento"}
        sub={<span className="flex items-center gap-2">{expirado ? <Badge tom="vermelho">Vencido</Badge> : <Badge tom={tomStatus(status)}>{STATUS_ORCAMENTO[status]}</Badge>}
          {Number(orc?.revisao) > 0 && <span>revisão {String(orc?.revisao)}</span>}{orc?.aprovado_por ? <span>· {String(orc.aprovado_por)}</span> : null}</span>}
        acoes={<>
          <Link href="/orcamentos/"><Button variant="ghost">Voltar</Button></Link>
          {id && <Button variant="secondary" onClick={async () => { const { data: r } = await sb().from("orcamento_revisoes").select("id,revisao,evento,created_at,dados").eq("orcamento_id", id).order("id", { ascending: false }).limit(50); setRevisoes((r || []) as typeof revisoes); setDialogo("revisoes"); }}><History className="h-4 w-4" /> Histórico</Button>}
          {id && <Link href={`/orcamentos/imprimir/?id=${id}`} target="_blank"><Button variant="secondary"><Printer className="h-4 w-4" /> PDF</Button></Link>}
          {id && app.pode("orcamentos_criar") && app.podeEscrever && <Button variant="secondary" onClick={() => fluxo("duplicar")}><Copy className="h-4 w-4" /> Duplicar</Button>}
          {pode && <Button variant="secondary" loading={salvando} onClick={() => salvar()}>Salvar rascunho</Button>}
          {pode && <Button loading={salvando} onClick={() => fluxo("enviar")}><Send className="h-4 w-4" /> {status === "enviado" ? "Reenviar" : "Gerar link e enviar"}</Button>}
        </>} />

      {congelado && <div className="mb-4"><Aviso tom={status === "cancelado" ? "amarelo" : "verde"}>Orçamento {STATUS_ORCAMENTO[status].toLowerCase()}: os valores foram preservados como estavam no momento da aprovação. Para mudar, use <b>Duplicar</b>.</Aviso></div>}
      {status === "enviado" && orc?.visualizado_em ? <div className="mb-4"><Aviso>O cliente abriu o link em {new Date(orc.visualizado_em as string).toLocaleString("pt-BR")}.</Aviso></div> : null}
      {expirado && <div className="mb-4"><Aviso tom="amarelo">A validade venceu em {data(orc?.validade as string)}. O cliente não consegue mais aprovar pelo link — ajuste a validade e reenvie.</Aviso></div>}

      {id && app.pode("orcamentos_criar") && app.podeEscrever && (
        <div className="mb-4 flex flex-wrap gap-2">
          {link && <Button size="sm" variant="secondary" onClick={() => setDialogo("enviado")}><Link2 className="h-4 w-4" /> Link do cliente</Button>}
          {["rascunho", "enviado"].includes(status) && app.pode("descontos_aprovar") && <Button size="sm" variant="secondary" onClick={() => setDialogo("aprovar")}><Check className="h-4 w-4 text-emerald-600" /> Aprovar</Button>}
          {["rascunho", "enviado"].includes(status) && <Button size="sm" variant="secondary" onClick={() => setDialogo("rejeitar")}><X className="h-4 w-4 text-red-600" /> Recusado</Button>}
          {status === "aprovado" && app.pode("pedidos_editar") && <Button size="sm" onClick={() => setDialogo("converter")}><ShoppingCart className="h-4 w-4" /> Converter em pedido</Button>}
          {status === "convertido" && !!orc?.pedido_id && <Link href={`/pedidos/?id=${orc.pedido_id}`}><Button size="sm" variant="secondary"><ShoppingCart className="h-4 w-4" /> Ver pedido</Button></Link>}
          {!["convertido", "cancelado"].includes(status) && <Button size="sm" variant="ghost" onClick={() => setDialogo("cancelar")}><Ban className="h-4 w-4" /> Cancelar</Button>}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <fieldset disabled={!pode} className="space-y-3">
              <Grid>
                <Field label="Cliente">
                  <div className="flex gap-1">
                    <Select value={cab.cliente_id} onChange={(e) => setCab({ ...cab, cliente_id: e.target.value })}><option value="">Sem cliente</option>{base?.clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select>
                    {pode && <Button type="button" variant="secondary" onClick={() => setDialogo("cliente")} aria-label="Novo cliente" title="Novo cliente"><Plus className="h-4 w-4" /></Button>}
                  </div>
                </Field>
                <Field label="Título / projeto"><Input required maxLength={200} value={cab.titulo} onChange={(e) => setCab({ ...cab, titulo: e.target.value })} placeholder="Ex.: Miniaturas para RPG" /></Field>
              </Grid>
              <Field label="Descrição"><Textarea value={cab.descricao} onChange={(e) => setCab({ ...cab, descricao: e.target.value })} /></Field>
              <Grid cols={4}>
                <Field label="Validade"><Input type="date" value={cab.validade} onChange={(e) => setCab({ ...cab, validade: e.target.value })} /></Field>
                <Field label="Prazo de entrega (dias)"><Input inputMode="numeric" value={cab.prazo_entrega_dias} onChange={(e) => setCab({ ...cab, prazo_entrega_dias: e.target.value })} /></Field>
                <Field label="Frete cobrado (R$)"><Input inputMode="decimal" value={cab.frete_cobrado} onChange={(e) => setCab({ ...cab, frete_cobrado: e.target.value })} /></Field>
                <Field label="Desconto (R$)" hint={`Acima de ${app.config.desconto_livre_pct}% exige aprovação`}><Input inputMode="decimal" value={cab.desconto_valor} onChange={(e) => setCab({ ...cab, desconto_valor: e.target.value })} /></Field>
              </Grid>
            </fieldset>
          </Card>

          <div className="space-y-3">
            {itens.map((it, idx) => <ItemCard key={it._key} it={it} idx={idx} base={base!} pode={pode} verCusto={verCusto} aberto={aberto === it._key} congelado={congelado}
              salvo={it._id ? salvos[it._id] : undefined} c={calc(it)} onToggle={() => setAberto(aberto === it._key ? null : it._key)} onChange={(p) => setItem(it._key, p)}
              onProduto={(pid) => escolherProduto(it, pid)} onRemover={() => { if (it._id) setRemovidos([...removidos, it._id]); setItens(itens.filter((x) => x._key !== it._key)); }} />)}
            {pode && <Button variant="secondary" onClick={() => setItens([...itens, itemVazio()])}><Plus className="h-4 w-4" /> Adicionar item</Button>}
          </div>

          <Card>
            <fieldset disabled={!pode} className="space-y-3">
              <Field label="Observações para o cliente"><Textarea value={cab.observacoes} onChange={(e) => setCab({ ...cab, observacoes: e.target.value })} /></Field>
              <Field label="Condições (pagamento, entrega, garantia)"><Textarea value={cab.condicoes} onChange={(e) => setCab({ ...cab, condicoes: e.target.value })} placeholder="50% na aprovação e 50% na entrega. Pix ou cartão." /></Field>
            </fieldset>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardTitle>Resumo</CardTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Subtotal dos itens</dt><dd className="tnum">{brl(resumo.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Desconto</dt><dd className="tnum text-red-600">− {brl(resumo.desconto)}</dd></div>
              <div className="flex justify-between"><dt>Frete cobrado</dt><dd className="tnum">{brl(resumo.frete)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700"><dt>Total</dt><dd className="tnum">{brl(resumo.total)}</dd></div>
              {verCusto && <>
                <div className="flex justify-between pt-2 text-slate-500"><dt>Custo de produção</dt><dd className="tnum">{brl(resumo.custo)}</dd></div>
                <div className={cn("flex justify-between font-medium", resumo.lucro >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}><dt>Lucro estimado</dt><dd className="tnum">{brl(resumo.lucro)}</dd></div>
                <p className="text-xs text-slate-500">Lucro já descontados custos, impostos e taxas. {id && !congelado && "Valores oficiais são recalculados ao salvar."}</p>
              </>}
            </dl>
          </Card>
        </div>
      </div>

      <Modal aberto={dialogo === "enviado"} titulo="Link de aprovação do cliente" onClose={() => setDialogo(null)}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">O cliente vê os itens e o total (sem custos) e pode aprovar ou recusar até {data(orc?.validade as string)}.</p>
        <div className="flex gap-2"><Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link" />
          <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(link); toast("Link copiado"); }}><Copy className="h-4 w-4" /></Button></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {linkWhats(cliente?.whatsapp || cliente?.telefone, msgWhats)
            ? <a href={linkWhats(cliente?.whatsapp || cliente?.telefone, msgWhats)!} target="_blank" rel="noreferrer" onClick={() => rpc("registrar_compartilhamento", { p_orcamento: id, p_canal: "whatsapp" }).catch(() => undefined)}><Button><MessageCircle className="h-4 w-4" /> Enviar no WhatsApp</Button></a>
            : <a href={`https://wa.me/?text=${encodeURIComponent(msgWhats)}`} target="_blank" rel="noreferrer" onClick={() => rpc("registrar_compartilhamento", { p_orcamento: id, p_canal: "whatsapp" }).catch(() => undefined)}><Button><MessageCircle className="h-4 w-4" /> Escolher contato no WhatsApp</Button></a>}
          <Link href={`/orcamentos/imprimir/?id=${id}`} target="_blank"><Button variant="secondary"><Printer className="h-4 w-4" /> Gerar PDF</Button></Link>
        </div>
      </Modal>
      <Confirmar aberto={dialogo === "aprovar"} titulo="Marcar como aprovado" onCancel={() => setDialogo(null)} onOk={() => fluxo("aprovar")} carregando={salvando} confirmar="Aprovar"
        texto="Use quando o cliente aprovou por outro canal (WhatsApp, telefone). Os valores ficam congelados." />
      <Confirmar aberto={dialogo === "rejeitar"} titulo="Cliente recusou" onCancel={() => setDialogo(null)} onOk={() => fluxo("rejeitar")} carregando={salvando} confirmar="Registrar recusa" perigo>
        <div className="mt-3"><Field label="Motivo"><Input required value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Preço, prazo, desistiu…" /></Field></div>
      </Confirmar>
      <Confirmar aberto={dialogo === "cancelar"} titulo="Cancelar orçamento" onCancel={() => setDialogo(null)} onOk={() => fluxo("cancelar")} carregando={salvando} confirmar="Cancelar orçamento" perigo
        texto="O link do cliente deixa de funcionar. O histórico é mantido." />
      <Confirmar aberto={dialogo === "converter"} titulo="Converter em pedido" onCancel={() => setDialogo(null)} onOk={() => fluxo("converter")} carregando={salvando} confirmar="Criar pedido"
        texto={<>Será criado um pedido de <b>{brl(orc?.total as number)}</b> com os itens deste orçamento e entrega em {String(orc?.prazo_entrega_dias ?? 0)} dia(s). Só é possível uma vez.</>} />
      <Modal aberto={dialogo === "revisoes"} titulo="Histórico do orçamento" onClose={() => setDialogo(null)}>
        {!revisoes.length ? <p className="text-sm text-slate-500">Ainda não há eventos. Eles aparecem ao enviar, aprovar, recusar ou converter.</p> : (
          <Table head={["Quando", "Evento", "Revisão", "Total"]}>{revisoes.map((r) => (
            <tr key={r.id}><Td>{dataHora(r.created_at)}</Td><Td>{({ enviado: "Enviado", aprovado: "Aprovado (interno)", rejeitado: "Recusado (interno)", aprovado_cliente: "Aprovado pelo cliente", rejeitado_cliente: "Recusado pelo cliente", convertido: "Virou pedido", cancelado: "Cancelado" } as Record<string, string>)[r.evento] || r.evento}</Td>
              <Td>{r.revisao}</Td><Td className="tnum">{brl(r.dados?.orcamento?.total)}</Td></tr>))}</Table>
        )}
      </Modal>
      <Modal aberto={dialogo === "cliente"} titulo="Novo cliente" onClose={() => setDialogo(null)}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const c = await q<Cli>(sb().from("clientes").insert({ empresa_id: app.empresa.id, nome: novoCli.nome, whatsapp: novoCli.whatsapp || null }).select("id,nome,whatsapp,telefone,margem_pct").single()); setBase((b) => b && { ...b, clis: [...b.clis, c].sort((a, x) => a.nome.localeCompare(x.nome)) }); setCab({ ...cab, cliente_id: c.id }); setNovoCli({ nome: "", whatsapp: "" }); setDialogo(null); } catch (e2) { erro(e2); } }}>
          <Field label="Nome"><Input required autoFocus value={novoCli.nome} onChange={(e) => setNovoCli({ ...novoCli, nome: e.target.value })} /></Field>
          <Field label="WhatsApp"><Input inputMode="tel" value={novoCli.whatsapp} onChange={(e) => setNovoCli({ ...novoCli, whatsapp: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDialogo(null)}>Cancelar</Button><Button type="submit">Cadastrar</Button></div>
        </form>
      </Modal>
    </>
  );
}

function ItemCard({ it, idx, base, pode, verCusto, aberto, congelado, salvo, c, onToggle, onChange, onProduto, onRemover }: {
  it: Item; idx: number; base: { mats: Mat[]; imps: Imp[]; prods: Prod[] }; pode: boolean; verCusto: boolean; aberto: boolean; congelado: boolean;
  salvo?: Record<string, number>; c: Record<string, unknown>; onToggle: () => void; onChange: (p: Partial<Item>) => void; onProduto: (pid: string) => void; onRemover: () => void;
}) {
  const app = useApp();
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [preenchimento, setPreenchimento] = useState("20");
  const [lendo, setLendo] = useState(false);
  const v = (k: string) => (congelado && salvo ? Number(salvo[k]) : undefined);
  const preco = v("preco_unitario") ?? (c.preco as number);
  const total = v("preco_total") ?? (c.total as number);
  const custo = v("custo_unitario") ?? (c.custo as number);
  const campo = (k: string, label: string, hint?: string, sufixo?: string) => (
    <Field label={label} hint={hint}><div className="relative"><Input inputMode="decimal" value={it[k] || ""} onChange={(e) => onChange({ [k]: e.target.value })} className={sufixo ? "pr-10" : ""} />
      {sufixo && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{sufixo}</span>}</div></Field>
  );
  const material = base.mats.find((m) => m.id === it.material_id);
  const ler = async (arq: File | undefined) => {
    if (!arq) return; setLendo(true);
    try {
      const ext = arq.name.split(".").pop()?.toLowerCase();
      if (["stl", "3mf"].includes(ext || "")) { const a = await analisarModelo(arq); setAnalise(a); onChange({ volume_cm3: a.volume_cm3.toFixed(2).replace(".", ",") }); }
      const path = await enviarArquivo(app.empresa.id, "orcamentos", arq);
      onChange({ arquivo_path: path, arquivo_nome: arq.name, descricao: it.descricao || arq.name.replace(/\.[^.]+$/, "") });
      toast("Arquivo anexado ao item");
    } catch (e) { erro(e); } finally { setLendo(false); }
  };
  // estimativa grosseira: casca sólida + preenchimento — o fatiador é quem dá o valor real
  const pesoEstimado = analise ? analise.volume_cm3 * densidadeDe(material?.material || material?.nome) * Math.min(1, 0.3 + (Number(preenchimento) || 0) / 100 * 0.7) : null;

  return (
    <Card className="p-0">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-3 text-left">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold dark:bg-slate-800">{idx + 1}</span>
        <div className="min-w-0 flex-1"><div className="truncate font-medium">{it.descricao || "Novo item"}</div>
          <div className="text-xs text-slate-500">{[num(numOuNull(it.quantidade) || 0)] + " un"}{it.peso_g && ` · ${it.peso_g} g`}{it.tempo_h && ` · ${it.tempo_h} h`}{material && ` · ${material.nome}`}{it.arquivo_nome && ` · 📎 ${it.arquivo_nome}`}</div></div>
        <div className="text-right"><div className="tnum font-semibold">{Number.isFinite(total) ? brl(total) : "—"}</div><div className="tnum text-xs text-slate-500">{Number.isFinite(preco) ? `${brl(preco)}/un` : "percentuais ≥ 100%"}</div></div>
        {aberto ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {aberto && (
        <div className="space-y-4 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <fieldset disabled={!pode} className="space-y-4">
            <Grid cols={3}>
              <Field label="Produto do catálogo"><Select value={it.produto_id} onChange={(e) => onProduto(e.target.value)}><option value="">Peça sob encomenda</option>{base.prods.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>
              <Field label="Descrição"><Input required value={it.descricao} onChange={(e) => onChange({ descricao: e.target.value })} /></Field>
              {campo("quantidade", "Quantidade", undefined, "un")}
              <Field label="Tecnologia"><Select value={it.tecnologia} onChange={(e) => onChange({ tecnologia: e.target.value })}>{Object.entries(TECNOLOGIAS).map(([k, v2]) => <option key={k} value={k}>{v2}</option>)}</Select></Field>
              <Field label="Impressora"><Select value={it.impressora_id} onChange={(e) => onChange({ impressora_id: e.target.value })}><option value="">—</option>{base.imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
              <Field label="Material"><Select value={it.material_id} onChange={(e) => onChange({ material_id: e.target.value })}><option value="">—</option>{base.mats.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field>
              <Field label="Cor"><Input value={it.cor} onChange={(e) => onChange({ cor: e.target.value })} /></Field>
              {campo("peso_g", "Peso por peça", "Use o valor do fatiador", "g")}
              {campo("tempo_h", "Tempo de impressão", "Por peça, do fatiador", "h")}
            </Grid>
            <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
              <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300", lendo && "opacity-50")}>
                <Upload className="h-4 w-4" /> {lendo ? "Lendo arquivo…" : it.arquivo_nome ? `Arquivo: ${it.arquivo_nome} (trocar)` : "Anexar STL, 3MF, OBJ ou STEP"}
                <input type="file" className="hidden" disabled={lendo} accept=".stl,.3mf,.obj,.step,.stp" onChange={(e) => { ler(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {analise && (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300"><span><Box className="mr-1 inline h-3.5 w-3.5" />{analise.formato}</span><span>Volume geométrico: <b>{num(analise.volume_cm3, 2)} cm³</b></span>
                    <span>Dimensões: {analise.dimensoes_mm.join(" × ")} mm</span><span>{num(analise.triangulos, 0)} triângulos</span></div>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Preenchimento (%)"><Input className="w-24" inputMode="numeric" value={preenchimento} onChange={(e) => setPreenchimento(e.target.value)} /></Field>
                    <div className="pb-2">≈ <b>{num(pesoEstimado, 0)} g</b> (estimativa)</div>
                    {pode && <Button type="button" size="sm" variant="secondary" className="mb-0.5" onClick={() => onChange({ peso_g: String(Math.round(pesoEstimado || 0)) })}>Usar estimativa</Button>}
                  </div>
                  <Aviso tom="amarelo">O volume vem da geometria do arquivo. Peso e tempo reais dependem do fatiador (paredes, preenchimento, suportes, velocidade). Para orçar com precisão, fatie a peça e digite peso e tempo do fatiador.{analise.aviso ? ` ${analise.aviso}` : ""}</Aviso>
                </div>
              )}
            </div>
            <Grid cols={4}>
              {campo("mao_obra_h", "Mão de obra", `${brl(app.config.mao_obra_hora)}/h`, "h")}
              {campo("suportes_custo", "Suportes / pós", undefined, "R$")}
              {campo("acabamento_custo", "Acabamento", undefined, "R$")}
              {campo("pintura_custo", "Pintura", undefined, "R$")}
              {campo("embalagem_custo", "Embalagem", undefined, "R$")}
              {campo("frete_assumido", "Frete pago pela empresa", undefined, "R$")}
              {campo("outros_custos", "Outros custos", undefined, "R$")}
              {campo("desconto_terceiros", "Desconto de terceiros", "Ex.: subsídio de fornecedor", "R$")}
            </Grid>
            <Grid cols={4}>
              {campo("desperdicio_pct", "Desperdício", `Padrão ${app.config.desperdicio_pct}%`, "%")}
              {campo("margem_pct", "Margem", `Padrão ${num(c.margem as number, 2)}%`, "%")}
              {campo("impostos_pct", "Impostos", `Padrão ${app.config.impostos_pct}%`, "%")}
              {campo("taxas_pct", "Taxas", `Padrão ${app.config.taxas_pct}%`, "%")}
            </Grid>
            <Grid>{campo("preco_manual", "Preço unitário manual (opcional)", "Substitui o preço calculado", "R$")}</Grid>
          </fieldset>
          {verCusto && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <div className="mb-2 font-medium">Composição do custo por peça {congelado && "(como aprovado)"}</div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div className="flex justify-between"><span>Material {material && <span className="text-xs text-slate-500">({brl(c.precoKg as number)}/kg + {num(c.desp as number)}% perdas)</span>}</span><span className="tnum">{brl(v("custo_material") ?? (c.material as number))}</span></div>
                <div className="flex justify-between"><span>Energia</span><span className="tnum">{brl(v("custo_energia") ?? (c.energia as number))}</span></div>
                <div className="flex justify-between"><span>Máquina (depreciação + manutenção)</span><span className="tnum">{brl(v("custo_maquina") ?? (c.maquina as number))}</span></div>
                <div className="flex justify-between"><span>Mão de obra</span><span className="tnum">{brl(v("custo_mao_obra") ?? (c.maoObra as number))}</span></div>
                <div className="flex justify-between font-medium sm:col-span-2 border-t border-slate-200 pt-1 dark:border-slate-700"><span>Custo total por peça</span><span className="tnum">{brl(custo)}</span></div>
                <div className="flex justify-between sm:col-span-2"><span>Preço = custo ÷ (1 − {num(v("margem_efetiva") ?? (c.margem as number))}% − {num(v("impostos_efetivo") ?? (c.impostos as number))}% − {num(v("taxas_efetiva") ?? (c.taxas as number))}%)</span><span className="tnum font-semibold">{Number.isFinite(preco) ? brl(preco) : "inválido"}</span></div>
              </div>
            </div>
          )}
          {!app.pode("descontos_aprovar") && <p className="text-xs text-slate-500">Preço abaixo do calculado (margem, impostos ou taxas menores, preço manual ou desconto de terceiros) precisa de quem pode aprovar descontos.</p>}
          {pode && <button type="button" onClick={onRemover} className="flex items-center gap-1 text-sm text-red-600 hover:underline"><Trash2 className="h-4 w-4" /> Remover item</button>}
        </div>
      )}
    </Card>
  );
}
