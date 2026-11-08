"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Loader2, Save, Plus, Info, Layers, Clock, Weight, Printer as IconePrinter, Library } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, urlTemporaria } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, numOuNull, erroMsg, cn } from "@/lib/utils";
import { importarArquivo, sugerirMaterial, precoKg, type Importado, type MatCadastro } from "@/lib/importar3d";
import { salvarNaBiblioteca, type Projeto } from "@/lib/biblioteca";
import { calcularItem, custoMaterial, depreciacaoHora, type Config as CfgCalc } from "@/lib/precificacao";
import { Button, Card, CardTitle, Field, Input, Select, Grid, Modal, Table, Td, Loading, ErrorBox, Badge, Aviso, Checkbox } from "@/components/ui";

type Imp = { id: string; nome: string; potencia_w: number; custo_hora: number; custo_aquisicao: number; vida_util_horas: number; custo_manutencao_hora: number; valor_residual: number; custo_operacional_hora: number; modelo: string | null; fabricante: string | null; status: string };
type Cli = { id: string; nome: string; margem_pct: number | null };
type Mat = MatCadastro & { margem_pct: number | null };
type FilSlot = { slot: number; tipo: string | null; cor: string | null; perfil: string | null; material_id: string };
type PlacaEd = { indice: number; nome: string | null; tempo_min: string; objetos: string[]; incluir: boolean; copias: string; pesos: Record<number, string> };
type Fonte = { tipo: "arquivo"; imp: Importado; miniatura: string | null } | { tipo: "projeto"; projeto: Projeto; miniatura: string | null };

export default function ImportarBambu() { return <Exige perm="orcamentos_criar"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const router = useRouter();
  const projetoUrl = useParam("projeto");
  const [processando, setProcessando] = useState(false);
  const [falha, setFalha] = useState("");
  const [fonte, setFonte] = useState<Fonte | null>(null);
  const [nome, setNome] = useState("");
  const [slots, setSlots] = useState<FilSlot[]>([]);
  const [placas, setPlacas] = useState<PlacaEd[]>([]);
  const [modo, setModo] = useState<"placa" | "peca">("placa");
  const [impressora, setImpressora] = useState("");
  const [cliente, setCliente] = useState("");
  const [margem, setMargem] = useState<number | null>(null);
  const [desp, setDesp] = useState<number>(app.config.desperdicio_pct);
  const [extras, setExtras] = useState({ mao_obra_h: "", acabamento: "", embalagem: String(app.config.embalagem_padrao || "").replace(".", ",") });
  const [novoMat, setNovoMat] = useState<{ slot: number; nome: string; cor: string; material: string; preco: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { dados, recarregar } = useDados(async () => {
    const [imps, clis, mats] = await Promise.all([
      q<Imp[]>(sb().from("impressoras").select("id,nome,potencia_w,custo_hora,custo_aquisicao,vida_util_horas,custo_manutencao_hora,valor_residual,custo_operacional_hora,modelo,fabricante,status").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")),
      app.pode("clientes_ver") ? q<Cli[]>(sb().from("clientes").select("id,nome,margem_pct").eq("empresa_id", app.empresa.id).eq("arquivado", false).order("nome")) : Promise.resolve([] as Cli[]),
      q<Mat[]>(sb().from("materiais").select("id,nome,cor,material,categoria,unidade,custo_medio,peso_liquido_g,quantidade,quantidade_reservada,margem_pct").eq("empresa_id", app.empresa.id).eq("ativo", true)
        .in("categoria", ["filamento", "resina"]).order("nome")),
    ]);
    return { imps, clis, mats };
  }, [app.empresa.id]);

  // monta a edição a partir do que foi extraído (arquivo novo ou projeto da biblioteca)
  const preparar = (ex: { nome: string | null; impressora: string | null; placas: { indice: number; nome: string | null; tempo_min: number | null; objetos: string[]; filamentos: { slot: number; peso_g: number | null }[] }[];
    filamentos: { slot: number; tipo: string | null; cor: string | null; perfil: string | null; peso_g: number | null }[]; tempo_total_min: number | null }) => {
    setNome(ex.nome || "Projeto importado");
    const mats = dados?.mats || [];
    setSlots(ex.filamentos.map((f) => ({ slot: f.slot, tipo: f.tipo, cor: f.cor, perfil: f.perfil, material_id: sugerirMaterial(f.tipo, f.cor, mats)?.id || "" })));
    const pls = ex.placas.length ? ex.placas : [{ indice: 1, nome: null, tempo_min: ex.tempo_total_min, objetos: [], filamentos: ex.filamentos.map((f) => ({ slot: f.slot, peso_g: f.peso_g })) }];
    setPlacas(pls.map((p) => ({ indice: p.indice, nome: p.nome, tempo_min: p.tempo_min != null ? String(p.tempo_min).replace(".", ",") : "", objetos: p.objetos, incluir: true, copias: "1",
      pesos: Object.fromEntries((p.filamentos.length ? p.filamentos : ex.filamentos.map((f) => ({ slot: f.slot, peso_g: null }))).map((f) => [f.slot, f.peso_g != null ? String(f.peso_g).replace(".", ",") : ""])) })));
    if (!ex.filamentos.length) setSlots([{ slot: 1, tipo: null, cor: null, perfil: null, material_id: "" }]);
    // impressora cadastrada com o mesmo modelo
    const imps = dados?.imps || [];
    const alvo = (ex.impressora || "").toLowerCase().replace(/bambu lab\s*/, "");
    setImpressora((alvo && imps.find((i) => `${i.fabricante || ""} ${i.modelo || ""} ${i.nome}`.toLowerCase().includes(alvo))?.id) || imps[0]?.id || "");
  };

  const processar = async (arq: File | undefined) => {
    if (!arq) return;
    setFalha(""); setProcessando(true); setFonte(null);
    try {
      const imp = await importarArquivo(arq);
      setFonte({ tipo: "arquivo", imp, miniatura: imp.miniatura ? URL.createObjectURL(new Blob([imp.miniatura as BlobPart], { type: "image/png" })) : null });
      preparar(imp);
    } catch (e) {
      const m = erroMsg(e); setFalha(m);
      rpc("registrar_evento_importacao", { p_empresa: app.empresa.id, p_tipo: "erro", p_mensagem: `${arq.name}: ${m}` }).catch(() => undefined);
    } finally { setProcessando(false); }
  };

  // reutilizar um projeto da biblioteca (?projeto=)
  useEffect(() => {
    if (!projetoUrl || !dados || fonte) return;
    (async () => {
      try {
        const [p] = await q<Projeto[]>(sb().from("projetos_3d").select("*").eq("id", projetoUrl));
        if (!p) throw new Error("Projeto não encontrado");
        const md = p.metadados as { placas?: { indice: number; nome: string | null; tempo_min: number | null; objetos: string[]; filamentos: { slot: number; peso_g: number | null; tipo: string | null; cor: string | null; perfil: string | null }[] }[]; filamentos?: { slot: number; tipo: string | null; cor: string | null; perfil: string | null; peso_g: number | null }[] };
        setFonte({ tipo: "projeto", projeto: p, miniatura: p.miniatura_path ? await urlTemporaria(p.miniatura_path).catch(() => null) : null });
        preparar({ nome: p.nome, impressora: p.impressora_modelo, placas: md.placas || [], tempo_total_min: p.tempo_estimado_min,
          filamentos: md.filamentos?.length ? md.filamentos : (p.materiais.length ? p.materiais : [null]).map((t, i) => ({ slot: i + 1, tipo: t, cor: p.cores[i] || null, perfil: null, peso_g: i === 0 ? p.peso_g : null })) });
      } catch (e) { setFalha(erroMsg(e)); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetoUrl, dados]);

  const imp = dados?.imps.find((i) => i.id === impressora);
  const cli = dados?.clis.find((c) => c.id === cliente);
  const matDe = (slot: number) => dados?.mats.find((m) => m.id === slots.find((s) => s.slot === slot)?.material_id);
  const cfg = app.config;
  const margemPadrao = cli?.margem_pct ?? matDe(slots[0]?.slot)?.margem_pct ?? cfg.margem_pct;
  const margemUsada = margem ?? margemPadrao;

  // cálculo: o mesmo motor do servidor (lib/precificacao); o valor oficial é recalculado ao salvar
  const cfgCalc: CfgCalc = { energia_kwh: cfg.energia_kwh, mao_obra_hora: cfg.mao_obra_hora, margem_pct: margemPadrao, impostos_pct: cfg.impostos_pct, taxas_pct: cfg.taxas_pct,
    desperdicio_pct: desp, custos_fixos_mensais: cfg.custos_fixos_mensais, horas_produtivas_mes: cfg.horas_produtivas_mes || 0, falha_metodo: cfg.falha_metodo || "nenhum",
    falha_pct: cfg.falha_pct || 0, taxa_sucesso_pct: cfg.taxa_sucesso_pct || 100 };
  const calc = useMemo(() => {
    const mo = numOuNull(extras.mao_obra_h) || 0, acab = numOuNull(extras.acabamento) || 0, emb = numOuNull(extras.embalagem) || 0;
    const maq = imp ? { potencia_w: imp.potencia_w, custo_aquisicao: imp.custo_aquisicao, valor_residual: imp.valor_residual || 0, vida_util_horas: imp.vida_util_horas,
      custo_manutencao_hora: imp.custo_manutencao_hora, custo_operacional_hora: imp.custo_operacional_hora || 0 } : null;
    let erroCalc = "";
    const itens = placas.filter((p) => p.incluir).map((p) => {
      const nObj = Math.max(p.objetos.length, 1);
      const div = modo === "peca" ? nObj : 1;
      const copias = Math.max(numOuNull(p.copias) || 0, 0);
      const quantidade = modo === "peca" ? copias * nObj : copias;
      const tempoH = (numOuNull(p.tempo_min) || 0) / 60 / div;
      const fil = slots.map((s) => ({ slot: s.slot, material: dados?.mats.find((m) => m.id === s.material_id) || null, peso: (numOuNull(p.pesos[s.slot]) || 0) / div })).filter((f) => f.peso > 0);
      let r: ReturnType<typeof calcularItem> | null = null;
      try {
        r = calcularItem({ filamentos: fil.map((f) => ({ gramas: f.peso, preco_kg: precoKg(f.material) })), tempo_h: tempoH, quantidade, mao_obra_h: mo / div, acabamento: acab, embalagem: emb,
          margem_pct: margem, desperdicio_pct: desp }, { ...cfgCalc, margem_pct: margemPadrao }, maq);
      } catch (e) { erroCalc = erroMsg(e); }
      const bruto = fil.reduce((t, f) => t + custoMaterial(f.peso, precoKg(f.material)), 0);
      const deprec = maq ? depreciacaoHora(maq) * tempoH : 0;
      return { p, quantidade, tempoH, fil, r, partes: { filamentos: bruto, perdas: (r?.porUnidade.material || 0) - bruto, energia: r?.porUnidade.energia || 0, deprec,
        manut: (r?.porUnidade.maquina || 0) - deprec, maoObra: r?.porUnidade.maoObra || 0, acab, emb, falha: r?.porUnidade.falha || 0, fixo: r?.porUnidade.fixo || 0 },
        custoUnit: r?.porUnidade.custo || 0, precoUnit: r?.precoUnit || 0, precoTotal: r?.precoTotal || 0, custoTotal: r?.custoTotal || 0, pesoUnit: fil.reduce((t, f) => t + f.peso, 0) };
    });
    const soma = (k: keyof (typeof itens)[number]["partes"]) => itens.reduce((t, i) => t + i.partes[k] * i.quantidade, 0);
    const preco = itens.reduce((t, i) => t + i.precoTotal, 0), custo = itens.reduce((t, i) => t + i.custoTotal, 0);
    const impostos = itens.reduce((t, i) => t + (i.r?.impostos || 0), 0), taxas = itens.reduce((t, i) => t + (i.r?.taxas || 0), 0), fixo = soma("fixo");
    const porMat = new Map<string, { m: Mat | null; nome: string; g: number; custo: number }>();
    for (const i of itens) for (const f of i.fil) {
      const k = f.material?.id || `slot-${f.slot}`;
      const a = porMat.get(k) || { m: f.material as Mat | null, nome: f.material ? `${f.material.nome}${f.material.cor ? ` · ${f.material.cor}` : ""}` : `Filamento ${f.slot} (sem cadastro)`, g: 0, custo: 0 };
      a.g += f.peso * i.quantidade; a.custo += custoMaterial(f.peso, precoKg(f.material)) * i.quantidade * (1 + desp / 100); porMat.set(k, a);
    }
    return { itens, preco, custo, fixo, impostos, taxas, lucroBruto: preco - custo - impostos - taxas, lucro: preco - custo - fixo - impostos - taxas, porMat: Array.from(porMat.values()), erroCalc,
      precoMinimo: itens.reduce((t, i) => t + (i.r?.precoMinimo || 0) * i.quantidade, 0),
      partes: { filamentos: soma("filamentos"), perdas: soma("perdas"), energia: soma("energia"), deprec: soma("deprec"), manut: soma("manut"), maoObra: soma("maoObra"), acab: soma("acab"), emb: soma("emb"), falha: soma("falha") } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placas, slots, modo, imp, desp, extras, margem, margemPadrao, dados, cfg]);

  const semMaterial = slots.some((s) => !s.material_id && placas.some((p) => p.incluir && (numOuNull(p.pesos[s.slot]) || 0) > 0));
  const semDados = calc.itens.some((i) => i.tempoH === 0 || i.pesoUnit === 0);
  const abaixo = margem != null && margem < margemPadrao && !app.pode("descontos_aprovar");

  const salvar = async () => {
    if (!fonte) return;
    setSalvando(true);
    try {
      let projetoId: string;
      if (fonte.tipo === "arquivo") {
        const r = await salvarNaBiblioteca(app.empresa.id, fonte.imp, { nome });
        projetoId = r.projeto.id;
        if (r.duplicado) toast(`Este arquivo já estava na biblioteca (${r.projeto.nome}): usando o mesmo projeto`);
      } else projetoId = fonte.projeto.id;
      const [o] = await q<{ id: string }[]>(sb().from("orcamentos").insert({ empresa_id: app.empresa.id, cliente_id: cliente || null, titulo: nome.slice(0, 200),
        descricao: [`Projeto: ${nome}`, fonte.tipo === "arquivo" && fonte.imp.fatiador ? `Fatiado no ${fonte.imp.fatiador}` : null, `${calc.itens.length} placa(s)`].filter(Boolean).join(" · ") }).select("id"));
      const itens = calc.itens.filter((i) => i.quantidade > 0).map((i, k) => {
        const ord = [...i.fil].sort((a, b) => b.peso - a.peso);
        const principal = ord[0];
        const nObj = Math.max(i.p.objetos.length, 1);
        return {
          empresa_id: app.empresa.id, orcamento_id: o.id, ordem: k + 1, projeto_id: projetoId, placa: i.p.indice, pecas_por_impressao: nObj,
          descricao: (modo === "peca" ? `${nome}${nObj > 1 ? ` (${i.p.objetos.slice(0, 3).join(", ")}${nObj > 3 ? "…" : ""})` : ""}` : `${nome} · placa ${i.p.indice}${i.p.nome ? ` (${i.p.nome})` : ""}${nObj > 1 ? ` · ${nObj} peças` : ""}`).slice(0, 300),
          material_id: principal?.material?.id || null, cor: slots.find((s) => s.slot === principal?.slot)?.cor || null, impressora_id: impressora || null, quantidade: i.quantidade,
          peso_g: Math.round((principal?.peso || 0) * 100) / 100, tempo_h: Math.round(i.tempoH * 100) / 100, desperdicio_pct: desp,
          filamentos_extras: ord.slice(1).map((f) => ({ material_id: f.material?.id || null, nome: slots.find((s) => s.slot === f.slot)?.tipo, peso_g: Math.round(f.peso * 100) / 100 })),
          mao_obra_h: Math.round(((numOuNull(extras.mao_obra_h) || 0) / (modo === "peca" ? nObj : 1)) * 100) / 100, acabamento_custo: numOuNull(extras.acabamento) || 0, embalagem_custo: numOuNull(extras.embalagem) || 0,
          margem_pct: margem, arquivo_path: fonte.tipo === "arquivo" ? null : fonte.projeto.arquivo_path, arquivo_nome: fonte.tipo === "arquivo" ? fonte.imp.arquivo.name.slice(0, 200) : fonte.projeto.arquivo_nome,
        };
      });
      if (!itens.length) throw new Error("Nenhuma placa com quantidade");
      if (fonte.tipo === "arquivo") { const [p] = await q<{ arquivo_path: string }[]>(sb().from("projetos_3d").select("arquivo_path").eq("id", projetoId)); itens.forEach((it) => { it.arquivo_path = p?.arquivo_path || null; }); }
      await q(sb().from("orcamento_itens").insert(itens));
      toast("Orçamento criado com os custos calculados");
      router.push(`/orcamentos/editar/?id=${o.id}`);
    } catch (e) { erro(e); setSalvando(false); }
  };

  const ext = fonte?.tipo === "arquivo" ? fonte.imp : null;
  return (
    <>
      <PageHeader titulo="Importar do Bambu Studio" sub="Envie o arquivo fatiado (.gcode.3mf) e o sistema calcula custo, margem e preço de venda"
        acoes={<Link href="/integracoes/bambu/?aba=projetos"><Button variant="secondary"><Library className="h-4 w-4" /> Biblioteca de projetos</Button></Link>} />
      {!fonte && <Card>
        <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50", processando && "pointer-events-none opacity-60")}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); processar(e.dataTransfer.files[0]); }}>
          {processando ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
          <span className="text-base"><b className="text-brand-700">{processando ? "Lendo o arquivo…" : "Arraste o arquivo aqui"}</b>{!processando && " ou clique para escolher"}</span>
          <span className="text-xs">.gcode.3mf (recomendado) · .3mf · .gcode · .stl — até 200 MB. O arquivo é lido no seu navegador; só vai para o servidor quando você salvar.</span>
          <input type="file" accept=".3mf,.gcode,.stl,.obj,.step,.stp" className="hidden" disabled={processando} onChange={(e) => { processar(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {falha && <div className="mt-4"><ErrorBox erro={falha} /></div>}
        <div className="mt-4"><Aviso>No Bambu Studio: fatie o projeto e use <b>Arquivo → Exportar → Exportar arquivo de placa fatiada</b> (gera o .gcode.3mf com tempo, peso e filamentos de cada placa).</Aviso></div>
      </Card>}

      {fonte && dados && <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap gap-5">
            <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">{fonte.miniatura ? <img src={fonte.miniatura} alt="" className="h-full w-full object-contain" /> : <Layers className="h-10 w-10 text-slate-300" />}</div>
            <div className="min-w-60 flex-1 space-y-2">
              <Field label="Nome do projeto"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tom="azul">{fonte.tipo === "projeto" ? "Da biblioteca" : ext?.tipo}</Badge>
                {ext?.fatiador && <Badge>{ext.fatiador}</Badge>}
                {(ext?.impressora || (fonte.tipo === "projeto" && fonte.projeto.impressora_modelo)) && <Badge><IconePrinter className="mr-1 h-3 w-3" />{ext?.impressora || (fonte.tipo === "projeto" ? fonte.projeto.impressora_modelo : "")}</Badge>}
                {ext?.altura_camada_mm && <Badge>Camada {num(ext.altura_camada_mm, 2)} mm</Badge>}
                {ext?.bico_mm && <Badge>Bico {num(ext.bico_mm, 2)} mm</Badge>}
                {ext?.preenchimento && <Badge>Preenchimento {ext.preenchimento}</Badge>}
                {ext?.suportes != null && <Badge>{ext.suportes ? "Com suportes" : "Sem suportes"}</Badge>}
                {ext?.geometria && <Badge>{ext.geometria.dimensoes_mm.join(" × ")} mm · {num(ext.geometria.volume_cm3, 1)} cm³</Badge>}
              </div>
              <div className="flex flex-wrap gap-5 text-sm">
                <span className="flex items-center gap-1"><Layers className="h-4 w-4 text-slate-400" /> {placas.length} placa(s) · {placas.reduce((t, p) => t + p.objetos.length, 0) || "—"} objeto(s)</span>
                <span className="flex items-center gap-1"><Clock className="h-4 w-4 text-slate-400" /> {horas(placas.reduce((t, p) => t + (numOuNull(p.tempo_min) || 0), 0))}</span>
                <span className="flex items-center gap-1"><Weight className="h-4 w-4 text-slate-400" /> {num(placas.reduce((t, p) => t + Object.values(p.pesos).reduce((s, v) => s + (numOuNull(v) || 0), 0), 0), 2)} g</span>
              </div>
              {ext?.avisos.map((a, i) => <Aviso key={i} tom="amarelo">{a}</Aviso>)}
              {ext?.peso_inclui_purga_suporte && <p className="flex items-start gap-1 text-xs text-slate-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> O peso do fatiador já inclui suportes, torre de purga e trocas de cor: nada é somado de novo. O arquivo não separa quanto foi de suporte ou purga.</p>}
            </div>
            <div><Button variant="ghost" onClick={() => { setFonte(null); setFalha(""); if (projetoUrl) history.replaceState(null, "", "/orcamentos/importar/"); }}>Trocar arquivo</Button></div>
          </div>
        </Card>

        <Card><CardTitle>Materiais do projeto</CardTitle>
          <Table head={["Filamento no arquivo", "Matéria-prima cadastrada", "Preço/kg", "Disponível", "Consumo", "Custo estimado"]}>
            {slots.map((s) => {
              const m = dados.mats.find((x) => x.id === s.material_id);
              const g = calc.porMat.find((x) => x.m?.id === s.material_id && s.material_id)?.g ?? calc.itens.reduce((t, i) => t + (i.fil.find((f) => f.slot === s.slot)?.peso || 0) * i.quantidade, 0);
              const disp = m ? m.quantidade - m.quantidade_reservada : null;
              const gDisp = m && disp != null ? disp * ({ kg: 1000, g: 1 } as Record<string, number>)[m.unidade] || (m.peso_liquido_g ? disp * m.peso_liquido_g : null) : null;
              return (
                <tr key={s.slot}>
                  <Td><div className="flex items-center gap-2">{s.cor && <span className="h-4 w-4 rounded-full border border-slate-300" style={{ background: s.cor }} />}<span>{s.slot}. {s.tipo || "—"}</span></div>{s.perfil && <div className="text-xs text-slate-500">{s.perfil}</div>}</Td>
                  <Td><div className="flex gap-1"><Select value={s.material_id} onChange={(e) => setSlots(slots.map((x) => x.slot === s.slot ? { ...x, material_id: e.target.value } : x))} className={cn("min-w-48", !s.material_id && "border-amber-400")}>
                    <option value="">Escolha…</option>{dados.mats.map((mm) => <option key={mm.id} value={mm.id}>{mm.nome}{mm.cor ? ` · ${mm.cor}` : ""}</option>)}</Select>
                    {app.pode("materia_editar") && <Button size="sm" variant="ghost" title="Cadastrar novo" onClick={() => setNovoMat({ slot: s.slot, nome: `${s.tipo || "Filamento"}${s.cor ? ` ${s.cor}` : ""}`, cor: s.cor || "", material: s.tipo || "", preco: "" })}><Plus className="h-4 w-4" /></Button>}</div></Td>
                  <Td className="tnum">{m ? brl(precoKg(m)) : "—"}{m && precoKg(m) === 0 && <div className="text-xs text-amber-600">sem custo cadastrado</div>}</Td>
                  <Td className={cn("tnum", gDisp != null && gDisp < g && "font-medium text-red-600")}>{gDisp != null ? `${num(gDisp, 0)} g` : "—"}{m && m.quantidade_reservada > 0 && <div className="text-xs text-slate-500">{num(m.quantidade_reservada)} {m.unidade} reservado</div>}</Td>
                  <Td className="tnum">{num(g, 2)} g</Td>
                  <Td className="tnum">{m ? brl((g / 1000) * precoKg(m) * (1 + desp / 100)) : "—"}</Td>
                </tr>);
            })}
          </Table>
          {semMaterial && <div className="mt-3"><Aviso tom="amarelo">Associe cada filamento usado a uma matéria-prima cadastrada para calcular o custo.</Aviso></div>}
        </Card>

        <Card><CardTitle right={<div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
          {([["placa", "Cobrar por placa"], ["peca", "Ratear por peça"]] as const).map(([k, l]) => <button key={k} onClick={() => setModo(k)} className={cn("rounded-md px-3 py-1", modo === k ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}>{l}</button>)}</div>}>
          Placas</CardTitle>
          <Table head={["", "Placa", "Objetos", "Tempo (min)", ...slots.map((s) => `Fil. ${s.slot} (g)`), "Impressões", modo === "peca" ? "Peças" : "Qtd.", "Custo/un.", "Preço/un.", "Total"]}>
            {placas.map((p, k) => { const c = calc.itens.find((i) => i.p.indice === p.indice); const set = (v: Partial<PlacaEd>) => setPlacas(placas.map((x, j) => j === k ? { ...x, ...v } : x)); return (
              <tr key={p.indice} className={p.incluir ? "" : "opacity-50"}>
                <Td><input type="checkbox" checked={p.incluir} onChange={(e) => set({ incluir: e.target.checked })} aria-label="Incluir placa" className="accent-brand-600" /></Td>
                <Td>{p.indice}{p.nome ? <div className="text-xs text-slate-500">{p.nome}</div> : null}</Td>
                <Td className="max-w-48 text-xs">{p.objetos.length ? `${p.objetos.length}: ${p.objetos.slice(0, 4).join(", ")}${p.objetos.length > 4 ? "…" : ""}` : "—"}</Td>
                <Td><Input className={cn("w-24", !numOuNull(p.tempo_min) && "border-amber-400")} inputMode="decimal" value={p.tempo_min} onChange={(e) => set({ tempo_min: e.target.value })} /></Td>
                {slots.map((s) => <Td key={s.slot}><Input className="w-20" inputMode="decimal" value={p.pesos[s.slot] ?? ""} onChange={(e) => set({ pesos: { ...p.pesos, [s.slot]: e.target.value } })} /></Td>)}
                <Td><Input className="w-20" inputMode="numeric" value={p.copias} onChange={(e) => set({ copias: e.target.value })} /></Td>
                <Td className="tnum">{c ? num(c.quantidade, 0) : "—"}</Td>
                <Td className="tnum">{c ? brl(c.custoUnit) : "—"}</Td><Td className="tnum">{c ? brl(c.precoUnit) : "—"}</Td><Td className="tnum font-medium">{c ? brl(c.precoTotal) : "—"}</Td>
              </tr>); })}
          </Table>
          <p className="mt-2 text-xs text-slate-500">{modo === "peca" ? "Tempo e material de cada placa são divididos igualmente entre os objetos impressos juntos (o tempo da placa não é multiplicado por peça)." : "Cada impressão da placa é uma unidade no orçamento."} Campos em amarelo não vieram no arquivo: preencha à mão.</p>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Card><CardTitle>Parâmetros</CardTitle>
            <Grid>
              <Field label="Impressora" hint={imp ? `${num(imp.potencia_w, 0)} W · ${brl(imp.custo_hora)}/h (depreciação + manutenção)` : "Sem impressora: energia e máquina ficam zerados"}>
                <Select value={impressora} onChange={(e) => setImpressora(e.target.value)}><option value="">—</option>{dados.imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
              <Field label="Cliente (opcional)"><Select value={cliente} onChange={(e) => setCliente(e.target.value)}><option value="">—</option>{dados.clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
              <Field label={`Mão de obra por impressão (h) · ${brl(cfg.mao_obra_hora)}/h`}><Input inputMode="decimal" value={extras.mao_obra_h} onChange={(e) => setExtras({ ...extras, mao_obra_h: e.target.value })} placeholder="Ex.: 0,25" /></Field>
              <Field label="Desperdício adicional (%)"><Input inputMode="decimal" value={String(desp).replace(".", ",")} onChange={(e) => setDesp(numOuNull(e.target.value) ?? 0)} /></Field>
              <Field label="Acabamento por unidade (R$)"><Input inputMode="decimal" value={extras.acabamento} onChange={(e) => setExtras({ ...extras, acabamento: e.target.value })} /></Field>
              <Field label="Embalagem por unidade (R$)"><Input inputMode="decimal" value={extras.embalagem} onChange={(e) => setExtras({ ...extras, embalagem: e.target.value })} /></Field>
            </Grid>
            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between text-sm"><span className="font-medium">Margem de lucro desejada</span><span className="tnum font-semibold">{num(margemUsada, 1)}%{margem == null && <span className="ml-1 text-xs font-normal text-slate-500">(padrão)</span>}</span></div>
              <input type="range" min={0} max={Math.max(0, 95 - cfg.impostos_pct - cfg.taxas_pct)} step={0.5} value={margemUsada} onChange={(e) => setMargem(Number(e.target.value))} className="w-full accent-brand-600" aria-label="Margem" />
              {margem != null && <button className="text-xs text-brand-600 underline" onClick={() => setMargem(null)}>Voltar para o padrão ({num(margemPadrao, 1)}%)</button>}
              {abaixo && <Aviso tom="amarelo">Margem abaixo do padrão precisa de quem pode aprovar descontos: o orçamento não será salvo assim.</Aviso>}
            </div>
            <p className="mt-4 text-xs text-slate-500">Impostos {num(cfg.impostos_pct, 2)}% e taxas de venda {num(cfg.taxas_pct, 2)}% vêm de Configurações.{(cfg.horas_produtivas_mes || 0) > 0 ? ` Custos fixos: ${brl(cfg.custos_fixos_mensais)}/mês em ${num(cfg.horas_produtivas_mes || 0, 0)} h produtivas.` : " Para ratear custos fixos no preço, informe as horas produtivas do mês em Configurações."}</p>
          </Card>

          <Card className="lg:sticky lg:top-4 lg:self-start"><CardTitle>Resumo (estimado)</CardTitle>
            <dl className="space-y-1.5 text-sm">
              {([["Filamentos e resinas", calc.partes.filamentos], [`Desperdício previsto (${num(desp, 1)}%)`, calc.partes.perdas], ["Energia", calc.partes.energia], ["Depreciação da impressora", calc.partes.deprec],
                ["Manutenção e custo operacional", calc.partes.manut], ["Mão de obra", calc.partes.maoObra], ["Acabamento", calc.partes.acab], ["Embalagem", calc.partes.emb],
                ...(calc.partes.falha > 0 ? [["Reserva para falhas", calc.partes.falha]] : [])] as [string, number][]).map(([l, v]) =>
                <div key={l} className="flex justify-between"><dt className="text-slate-500">{l}</dt><dd className="tnum">{brl(v)}</dd></div>)}
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-medium dark:border-slate-800"><dt>Custo de produção</dt><dd className="tnum">{brl(calc.custo)}</dd></div>
              {calc.fixo > 0 && <div className="flex justify-between"><dt className="text-slate-500">Custos fixos alocados</dt><dd className="tnum">{brl(calc.fixo)}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Taxas de venda</dt><dd className="tnum">{brl(calc.taxas)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Impostos</dt><dd className="tnum">{brl(calc.impostos)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Preço mínimo (margem zero)</dt><dd className="tnum">{brl(calc.precoMinimo)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold dark:border-slate-800"><dt>Preço sugerido</dt><dd className="tnum">{brl(calc.preco)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Lucro bruto</dt><dd className="tnum">{brl(calc.lucroBruto)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Lucro após custos fixos</dt><dd className={cn("tnum font-medium", calc.lucro < 0 ? "text-red-600" : "text-emerald-600")}>{brl(calc.lucro)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Margem estimada</dt><dd className="tnum">{calc.preco > 0 ? `${num((calc.lucro / calc.preco) * 100, 1)}%` : "—"}</dd></div>
            </dl>
            {semDados && <div className="mt-3"><Aviso tom="amarelo">Há placa sem tempo ou sem peso: o custo fica incompleto.</Aviso></div>}
            {calc.erroCalc && <div className="mt-3"><Aviso tom="vermelho">{calc.erroCalc}</Aviso></div>}
            <Button className="mt-4 w-full" loading={salvando} disabled={!calc.itens.length || semMaterial || !!calc.erroCalc} onClick={salvar}><Save className="h-4 w-4" /> Salvar orçamento</Button>
            <p className="mt-2 text-xs text-slate-500">Salva o projeto na biblioteca e abre o orçamento, onde você gera o PDF, envia o link ao comprador e converte em pedido quando for aprovado. Os valores ficam congelados no orçamento; o custo real aparece depois, nas ordens de produção.</p>
          </Card>
        </div>
      </div>}

      <Modal aberto={!!novoMat} titulo="Cadastrar matéria-prima" onClose={() => setNovoMat(null)}>
        {novoMat && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try {
          const id = await rpc<string>("cadastrar_materia_prima", { p_empresa: app.empresa.id, p_dados: { nome: novoMat.nome, material: novoMat.material, cor: novoMat.cor, categoria: "filamento", unidade: "kg" },
            p_quantidade_inicial: 0, p_custo_unitario: numOuNull(novoMat.preco) });
          await recarregar(); setSlots((ss) => ss.map((x) => x.slot === novoMat.slot ? { ...x, material_id: id } : x)); toast("Matéria-prima cadastrada (sem estoque: lance a entrada em Matéria-prima)"); setNovoMat(null);
        } catch (e2) { erro(e2); } }}>
          <Field label="Nome"><Input required value={novoMat.nome} onChange={(e) => setNovoMat({ ...novoMat, nome: e.target.value })} /></Field>
          <Grid><Field label="Material"><Input value={novoMat.material} onChange={(e) => setNovoMat({ ...novoMat, material: e.target.value })} /></Field>
            <Field label="Cor"><Input value={novoMat.cor} onChange={(e) => setNovoMat({ ...novoMat, cor: e.target.value })} /></Field></Grid>
          <Field label="Preço por kg (R$)"><Input required inputMode="decimal" value={novoMat.preco} onChange={(e) => setNovoMat({ ...novoMat, preco: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNovoMat(null)}>Cancelar</Button><Button type="submit">Cadastrar</Button></div>
        </form>}
      </Modal>
      {!dados && fonte && <Loading />}
    </>
  );
}

const horas = (min: number) => min ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}min` : "—";
