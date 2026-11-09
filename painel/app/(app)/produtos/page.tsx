"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Upload, Trash2, Calculator, Paperclip, ArrowDownUp, FileDown } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, enviarArquivo, urlTemporaria } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, dataHora, numOuNull, TIPOS_PRODUTO, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Tabs, Checkbox, Aviso, Confirmar } from "@/components/ui";

type Produto = {
  id: string; codigo: string | null; nome: string; categoria: string | null; descricao: string | null; tipo: string; material_id: string | null; cor: string | null;
  peso_g: number | null; tempo_h: number | null; impressora_id: string | null; custo_padrao: number; preco_venda: number; margem_pct: number | null;
  personalizavel: boolean; controla_estoque: boolean; estoque_qtd: number; estoque_minimo: number; ficha_tecnica: string | null; foto_path: string | null; status: string;
};
type Variante = { id: string; produto_id: string; nome: string; sku: string | null; cor: string | null; peso_g: number | null; tempo_h: number | null; preco_venda: number | null; custo_padrao: number | null; estoque_qtd: number; ativo: boolean };
type Comp = { id: string; produto_id: string; material_id: string | null; componente_produto_id: string | null; quantidade: number; observacao: string | null };
type Arq = { id: string; produto_id: string; tipo: string; path: string; nome: string; tamanho: number | null; created_at: string };
const CAMPOS_NUM = ["peso_g", "tempo_h", "custo_padrao", "preco_venda", "margem_pct", "estoque_minimo"];
const vazio: Record<string, string> = { codigo: "", nome: "", categoria: "", descricao: "", tipo: "simples", material_id: "", cor: "", peso_g: "", tempo_h: "", impressora_id: "",
  custo_padrao: "", preco_venda: "", margem_pct: "", personalizavel: "", controla_estoque: "", estoque_minimo: "", ficha_tecnica: "", status: "ativo" };

export default function Produtos() { return <Exige perm="produtos_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.pode("produtos_editar") && app.podeEscrever;
  const verCusto = app.pode("custos_ver");
  const idUrl = useParam("id");
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("ativo");
  const [editar, setEditar] = useState<Produto | "novo" | null>(null);
  const [estoque, setEstoque] = useState<{ p: Produto; variante: string; tipo: string; quantidade: string; obs: string } | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [produtos, mats, imps] = await Promise.all([
      q<Produto[]>(sb().from("produtos").select("*").eq("empresa_id", app.empresa.id).order("nome").limit(5000)),
      q<{ id: string; nome: string; unidade: string; custo_medio: number }[]>(sb().from("materiais").select("id,nome,unidade,custo_medio").eq("empresa_id", app.empresa.id).eq("ativo", true).order("nome")),
      q<{ id: string; nome: string }[]>(sb().from("impressoras").select("id,nome").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")),
    ]);
    return { produtos, mats, imps };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl && dados) { const p = dados.produtos.find((x) => x.id === idUrl); if (p) setEditar(p); } }, [idUrl, dados]);

  const categorias = useMemo(() => Array.from(new Set((dados?.produtos || []).map((p) => p.categoria).filter(Boolean))) as string[], [dados]);
  const lista = (dados?.produtos || []).filter((p) => (!status || p.status === status) && (!cat || p.categoria === cat) &&
    (!busca.trim() || [p.nome, p.codigo, p.categoria].some((v) => v?.toLowerCase().includes(busca.trim().toLowerCase()))));
  const margem = (p: Produto) => p.preco_venda > 0 ? ((p.preco_venda - p.custo_padrao) / p.preco_venda) * 100 : null;

  return (
    <>
      <PageHeader titulo="Produtos" sub="Catálogo, ficha técnica, arquivos e estoque de produtos acabados" acoes={pode && <Button onClick={() => setEditar("novo")}><Plus className="h-4 w-4" /> Novo produto</Button>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Buscar por nome, código ou categoria" value={busca} onChange={(e) => setBusca(e.target.value)} className="min-w-60 flex-1" aria-label="Buscar" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-44" aria-label="Categoria"><option value="">Todas as categorias</option>{categorias.map((c) => <option key={c}>{c}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Situação"><option value="ativo">Ativos</option><option value="rascunho">Rascunhos</option><option value="inativo">Inativos</option><option value="">Todos</option></Select>
        </div>
        {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
        {carregando && !dados ? <Loading /> : lista.length === 0 ? <Empty texto="Nenhum produto" /> : (
          <Table head={["Produto", "Tipo", verCusto ? "Custo" : "", "Preço", verCusto ? "Margem" : "", "Estoque", ""]}>
            {lista.map((p) => { const m = margem(p); return (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setEditar(p)}>
                <Td><div className="font-medium">{p.nome}{p.codigo && <span className="ml-2 text-xs text-slate-400">{p.codigo}</span>}</div><div className="text-xs text-slate-500">{[p.categoria, p.cor, p.peso_g && `${num(p.peso_g)} g`, p.tempo_h && `${num(p.tempo_h)} h`].filter(Boolean).join(" · ")}</div></Td>
                <Td>{TIPOS_PRODUTO[p.tipo]}{p.personalizavel && <Badge tom="azul">personalizável</Badge>}</Td>
                <Td className="tnum">{verCusto ? brl(p.custo_padrao) : ""}</Td>
                <Td className="tnum font-medium">{brl(p.preco_venda)}</Td>
                <Td className={cn("tnum", m != null && m < 0 && "text-red-600")}>{verCusto && m != null ? `${num(m, 1)}%` : ""}</Td>
                <Td className="tnum">{p.controla_estoque ? <span className={cn(p.estoque_qtd <= p.estoque_minimo && "font-medium text-red-600")}>{num(p.estoque_qtd)} un</span> : "—"}</Td>
                <Td><div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {pode && p.controla_estoque && <button title="Entrada/saída de acabados" onClick={() => setEstoque({ p, variante: "", tipo: "entrada", quantidade: "", obs: "" })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Movimentar estoque"><ArrowDownUp className="h-4 w-4" /></button>}
                  <button onClick={() => setEditar(p)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Abrir"><Pencil className="h-4 w-4" /></button>
                </div></Td>
              </tr>); })}
          </Table>
        )}
      </Card>
      {editar && dados && <Editor p={editar === "novo" ? null : editar} mats={dados.mats} imps={dados.imps} categorias={categorias} pode={pode} verCusto={verCusto}
        onClose={() => setEditar(null)} onSalvo={() => { recarregar(); }} />}
      <Modal aberto={!!estoque} titulo={`Estoque · ${estoque?.p.nome}`} onClose={() => setEstoque(null)}>
        {estoque && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const s = await rpc<number>("movimentar_produto", { p_produto: estoque.p.id, p_variante: estoque.variante || null, p_tipo: estoque.tipo, p_quantidade: numOuNull(estoque.quantidade), p_observacao: estoque.obs || null }); toast(`Estoque: ${num(s)} un`); setEstoque(null); recarregar(); } catch (e2) { erro(e2); } }}>
          <Select value={estoque.tipo} onChange={(e) => setEstoque({ ...estoque, tipo: e.target.value })} aria-label="Tipo"><option value="entrada">Entrada (produzido)</option><option value="saida">Saída (vendido/perda)</option><option value="ajuste">Ajuste (contagem)</option></Select>
          <Field label={estoque.tipo === "ajuste" ? "Novo saldo" : "Quantidade"}><Input required autoFocus inputMode="decimal" value={estoque.quantidade} onChange={(e) => setEstoque({ ...estoque, quantidade: e.target.value })} /></Field>
          <Field label={estoque.tipo === "ajuste" ? "Justificativa" : "Observação"}><Input required={estoque.tipo === "ajuste"} value={estoque.obs} onChange={(e) => setEstoque({ ...estoque, obs: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEstoque(null)}>Cancelar</Button><Button type="submit">Registrar</Button></div>
        </form>}
      </Modal>
    </>
  );
}

function Editor({ p, mats, imps, categorias, pode, verCusto, onClose, onSalvo }: {
  p: Produto | null; mats: { id: string; nome: string; unidade: string; custo_medio: number }[]; imps: { id: string; nome: string }[]; categorias: string[];
  pode: boolean; verCusto: boolean; onClose: () => void; onSalvo: () => void;
}) {
  const app = useApp();
  const [id, setId] = useState(p?.id || null);
  const [aba, setAba] = useState<"dados" | "composicao" | "variacoes" | "arquivos" | "precos">("dados");
  const [f, setF] = useState<Record<string, string>>(() => p ? Object.fromEntries(Object.keys(vazio).map((k) => {
    const v = (p as unknown as Record<string, unknown>)[k]; return [k, typeof v === "boolean" ? (v ? "1" : "") : v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v)];
  })) : { ...vazio });
  const [salvando, setSalvando] = useState(false);
  const [custo, setCusto] = useState<Record<string, number> | null>(null);
  const [excluir, setExcluir] = useState(false);

  const salvar = async (e?: React.FormEvent) => {
    e?.preventDefault(); setSalvando(true);
    try {
      const reg: Record<string, unknown> = { ...f, personalizavel: !!f.personalizavel, controla_estoque: !!f.controla_estoque };
      for (const k of CAMPOS_NUM) reg[k] = numOuNull(f[k]);
      for (const k of ["custo_padrao", "preco_venda", "estoque_minimo"]) reg[k] = reg[k] ?? 0;
      for (const k of ["codigo", "categoria", "descricao", "material_id", "cor", "impressora_id", "ficha_tecnica"]) reg[k] = f[k] || null;
      if (id) await q(sb().from("produtos").update(reg).eq("id", id));
      else { const r = await q<{ id: string }>(sb().from("produtos").insert({ ...reg, empresa_id: app.empresa.id }).select("id").single()); setId(r.id); }
      toast("Produto salvo"); onSalvo();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const calcular = async () => {
    if (!id) { toast("Salve o produto primeiro", "erro"); return; }
    try { const c = await rpc<Record<string, number>>("calcular_custo_produto", { p_produto: id }); setCusto(c); } catch (e) { erro(e); }
  };
  const apagar = async () => { try { await q(sb().from("produtos").delete().eq("id", id!)); toast("Produto excluído"); onSalvo(); onClose(); } catch (e) { erro(e); } };
  const precoSugerido = (() => {
    const c = numOuNull(f.custo_padrao) || 0; const m = numOuNull(f.margem_pct) ?? app.config.margem_pct;
    const d = 1 - (m + app.config.impostos_pct + app.config.taxas_pct) / 100; return d > 0 ? c / d : null;
  })();

  return (
    <Modal aberto titulo={id ? f.nome || "Produto" : "Novo produto"} onClose={onClose} largura="max-w-4xl">
      <Tabs abas={[["dados", "Dados"], ["composicao", "Ficha técnica"], ["variacoes", "Variações"], ["arquivos", "Fotos e arquivos"], ["precos", "Histórico de preços"]]} ativa={aba} onChange={(a) => { if (!id && a !== "dados") { toast("Salve o produto primeiro", "erro"); return; } setAba(a); }} />
      {aba === "dados" && <form onSubmit={salvar} className="space-y-3">
        <fieldset disabled={!pode} className="space-y-3">
          <Grid cols={3}>
            <Field label="Nome"><Input required maxLength={200} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
            <Field label="Código"><Input maxLength={40} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></Field>
            <Field label="Categoria"><Input list="cats" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} /></Field>
            <Field label="Tipo"><Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS_PRODUTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Material padrão"><Select value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })}><option value="">—</option>{mats.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field>
            <Field label="Cor"><Input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></Field>
            <Field label="Peso previsto (g)" hint="Do fatiador"><Input inputMode="decimal" value={f.peso_g} onChange={(e) => setF({ ...f, peso_g: e.target.value })} /></Field>
            <Field label="Tempo estimado (h)" hint="Do fatiador"><Input inputMode="decimal" value={f.tempo_h} onChange={(e) => setF({ ...f, tempo_h: e.target.value })} /></Field>
            <Field label="Máquina compatível"><Select value={f.impressora_id} onChange={(e) => setF({ ...f, impressora_id: e.target.value })}><option value="">—</option>{imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
            {verCusto && <Field label="Custo padrão (R$)"><div className="flex gap-1"><Input inputMode="decimal" value={f.custo_padrao} onChange={(e) => setF({ ...f, custo_padrao: e.target.value })} />
              <Button type="button" variant="secondary" onClick={calcular} title="Calcular pela ficha técnica" aria-label="Calcular custo"><Calculator className="h-4 w-4" /></Button></div></Field>}
            <Field label="Preço de venda (R$)" hint={verCusto && precoSugerido ? `Sugerido: ${brl(precoSugerido)}` : undefined}><Input inputMode="decimal" value={f.preco_venda} onChange={(e) => setF({ ...f, preco_venda: e.target.value })} /></Field>
            {(app.pode("descontos_aprovar") || app.pode("config_editar")) && <Field label="Margem própria (%)" hint="Opcional, para orçamentos"><Input inputMode="decimal" value={f.margem_pct} onChange={(e) => setF({ ...f, margem_pct: e.target.value })} /></Field>}
            <Field label="Situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ativo">Ativo</option><option value="rascunho">Rascunho</option><option value="inativo">Inativo</option></Select></Field>
            {f.controla_estoque && <Field label="Estoque mínimo"><Input inputMode="decimal" value={f.estoque_minimo} onChange={(e) => setF({ ...f, estoque_minimo: e.target.value })} /></Field>}
          </Grid>
          <datalist id="cats">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
          {custo && <Aviso>Custo calculado: material {brl(custo.material)} + componentes {brl(custo.componentes)} + energia {brl(custo.energia)} + máquina {brl(custo.maquina)} = <b>{brl(custo.total)}</b>.{" "}
            <button type="button" className="underline" onClick={() => setF({ ...f, custo_padrao: String(custo.total).replace(".", ",") })}>Usar este valor</button></Aviso>}
          <div className="flex flex-wrap gap-6">
            <Checkbox label="Aceita personalização" checked={!!f.personalizavel} onChange={(v) => setF({ ...f, personalizavel: v ? "1" : "" })} />
            <Checkbox label="Controlar estoque de acabados" hint="Para itens de pronta entrega" checked={!!f.controla_estoque} onChange={(v) => setF({ ...f, controla_estoque: v ? "1" : "" })} />
          </div>
          <Field label="Descrição"><Textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
          <Field label="Ficha técnica / instruções de produção"><Textarea value={f.ficha_tecnica} onChange={(e) => setF({ ...f, ficha_tecnica: e.target.value })} placeholder="Altura de camada, preenchimento, suportes, acabamento…" /></Field>
        </fieldset>
        <div className="flex justify-between gap-2">
          {pode && id ? <Button type="button" variant="ghost" className="text-red-600" onClick={() => setExcluir(true)}><Trash2 className="h-4 w-4" /> Excluir</Button> : <span />}
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>{pode && <Button type="submit" loading={salvando}>Salvar</Button>}</div>
        </div>
      </form>}
      {aba === "composicao" && id && <Composicao produtoId={id} mats={mats} pode={pode} />}
      {aba === "variacoes" && id && <Variacoes produtoId={id} pode={pode} verCusto={verCusto} />}
      {aba === "arquivos" && id && <Arquivos produtoId={id} pode={pode} />}
      {aba === "precos" && id && <Precos produtoId={id} verCusto={verCusto} />}
      <Confirmar aberto={excluir} titulo="Excluir produto" perigo confirmar="Excluir" onCancel={() => setExcluir(false)} onOk={apagar}
        texto="Excluir o produto apaga variações, ficha técnica e arquivos. Pedidos antigos continuam com a descrição. Prefira marcar como Inativo." />
    </Modal>
  );
}

function Composicao({ produtoId, mats, pode }: { produtoId: string; mats: { id: string; nome: string; unidade: string; custo_medio: number }[]; pode: boolean }) {
  const app = useApp();
  const [novo, setNovo] = useState({ tipo: "material", ref: "", quantidade: "" });
  const { dados, recarregar } = useDados(async () => {
    const [comps, prods] = await Promise.all([
      q<Comp[]>(sb().from("produto_componentes").select("*").eq("produto_id", produtoId)),
      q<{ id: string; nome: string; custo_padrao: number }[]>(sb().from("produtos").select("id,nome,custo_padrao").eq("empresa_id", app.empresa.id).neq("id", produtoId).order("nome")),
    ]);
    return { comps, prods };
  }, [produtoId]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await q(sb().from("produto_componentes").insert({ empresa_id: app.empresa.id, produto_id: produtoId, quantidade: numOuNull(novo.quantidade),
        material_id: novo.tipo === "material" ? novo.ref : null, componente_produto_id: novo.tipo === "produto" ? novo.ref : null }));
      setNovo({ ...novo, ref: "", quantidade: "" }); recarregar();
    } catch (e2) { erro(e2); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Liste os materiais (na unidade do estoque) e, para kits, os produtos que compõem este item. Usado no cálculo de custo.</p>
      {!dados?.comps.length ? <Empty texto="Sem componentes" /> : (
        <Table head={["Componente", "Quantidade", "Custo", ""]}>
          {dados.comps.map((c) => { const m = mats.find((x) => x.id === c.material_id); const pr = dados.prods.find((x) => x.id === c.componente_produto_id); return (
            <tr key={c.id}><Td>{m ? m.nome : pr ? `Produto: ${pr.nome}` : "—"}</Td><Td className="tnum">{num(c.quantidade)} {m?.unidade || "un"}</Td>
              <Td className="tnum">{brl(c.quantidade * (m?.custo_medio ?? pr?.custo_padrao ?? 0))}</Td>
              <Td>{pode && <button onClick={async () => { try { await q(sb().from("produto_componentes").delete().eq("id", c.id)); recarregar(); } catch (e) { erro(e); } }} className="text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>}</Td></tr>); })}
        </Table>
      )}
      {pode && <form onSubmit={add} className="grid items-end gap-2 sm:grid-cols-[140px_1fr_120px_auto]">
        <Select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value, ref: "" })} aria-label="Tipo"><option value="material">Matéria-prima</option><option value="produto">Produto (kit)</option></Select>
        <Select required value={novo.ref} onChange={(e) => setNovo({ ...novo, ref: e.target.value })} aria-label="Componente"><option value="">Escolha…</option>
          {(novo.tipo === "material" ? mats : dados?.prods || []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select>
        <Input required inputMode="decimal" placeholder="Quantidade" value={novo.quantidade} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} aria-label="Quantidade" />
        <Button type="submit"><Plus className="h-4 w-4" /> Adicionar</Button>
      </form>}
    </div>
  );
}

function Variacoes({ produtoId, pode, verCusto }: { produtoId: string; pode: boolean; verCusto: boolean }) {
  const app = useApp();
  const [nova, setNova] = useState({ nome: "", sku: "", cor: "", preco_venda: "", custo_padrao: "" });
  const { dados, recarregar } = useDados(() => q<Variante[]>(sb().from("produto_variantes").select("*").eq("produto_id", produtoId).order("created_at")), [produtoId]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Ex.: tamanhos ou cores com preço próprio. Deixe o preço em branco para usar o do produto.</p>
      {!dados?.length ? <Empty texto="Sem variações" /> : (
        <Table head={["Variação", "SKU", "Cor", "Preço", verCusto ? "Custo" : "", "Estoque", ""]}>
          {dados.map((v) => (
            <tr key={v.id}><Td className="font-medium">{v.nome}</Td><Td>{v.sku || "—"}</Td><Td>{v.cor || "—"}</Td><Td className="tnum">{v.preco_venda != null ? brl(v.preco_venda) : "padrão"}</Td>
              <Td className="tnum">{verCusto && v.custo_padrao != null ? brl(v.custo_padrao) : ""}</Td><Td className="tnum">{num(v.estoque_qtd)}</Td>
              <Td>{pode && <button onClick={async () => { try { await q(sb().from("produto_variantes").delete().eq("id", v.id)); recarregar(); } catch (e) { erro(e); } }} className="text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>}</Td></tr>
          ))}
        </Table>
      )}
      {pode && <form className="grid items-end gap-2 sm:grid-cols-[1fr_120px_120px_110px_110px_auto]" onSubmit={async (e) => { e.preventDefault(); try { await q(sb().from("produto_variantes").insert({ empresa_id: app.empresa.id, produto_id: produtoId, nome: nova.nome, sku: nova.sku || null, cor: nova.cor || null, preco_venda: numOuNull(nova.preco_venda), custo_padrao: numOuNull(nova.custo_padrao) })); setNova({ nome: "", sku: "", cor: "", preco_venda: "", custo_padrao: "" }); recarregar(); } catch (e2) { erro(e2); } }}>
        <Input required placeholder="Nome (ex.: Grande)" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} aria-label="Nome" />
        <Input placeholder="SKU" value={nova.sku} onChange={(e) => setNova({ ...nova, sku: e.target.value })} aria-label="SKU" />
        <Input placeholder="Cor" value={nova.cor} onChange={(e) => setNova({ ...nova, cor: e.target.value })} aria-label="Cor" />
        <Input inputMode="decimal" placeholder="Preço" value={nova.preco_venda} onChange={(e) => setNova({ ...nova, preco_venda: e.target.value })} aria-label="Preço" />
        <Input inputMode="decimal" placeholder="Custo" value={nova.custo_padrao} onChange={(e) => setNova({ ...nova, custo_padrao: e.target.value })} aria-label="Custo" />
        <Button type="submit"><Plus className="h-4 w-4" /></Button>
      </form>}
    </div>
  );
}

function Arquivos({ produtoId, pode }: { produtoId: string; pode: boolean }) {
  const app = useApp();
  const [enviando, setEnviando] = useState(false);
  const { dados, recarregar } = useDados(() => q<Arq[]>(sb().from("produto_arquivos").select("*").eq("produto_id", produtoId).order("created_at", { ascending: false })), [produtoId]);
  const enviar = async (lista: FileList | null) => {
    if (!lista?.length) return; setEnviando(true);
    try {
      for (const arq of Array.from(lista)) {
        if (arq.size > 50 * 1024 * 1024) throw new Error(`${arq.name}: máximo 50 MB por arquivo`);
        const ext = arq.name.split(".").pop()?.toLowerCase() || "";
        const tipo = ["png", "jpg", "jpeg", "webp"].includes(ext) ? "foto" : ["stl", "3mf", "obj", "step", "stp", "gcode"].includes(ext) ? "modelo" : ext === "pdf" ? "documento" : null;
        if (!tipo) throw new Error(`${arq.name}: tipo não permitido. Use STL, 3MF, OBJ, STEP, G-code, imagens ou PDF.`);
        const path = await enviarArquivo(app.empresa.id, "produtos", arq);
        await q(sb().from("produto_arquivos").insert({ empresa_id: app.empresa.id, produto_id: produtoId, tipo, path, nome: arq.name, tamanho: arq.size }));
        if (tipo === "foto") await sb().from("produtos").update({ foto_path: path }).eq("id", produtoId).is("foto_path", null);
      }
      toast("Arquivo(s) enviado(s)"); recarregar();
    } catch (e) { erro(e); } finally { setEnviando(false); }
  };
  const abrir = async (a: Arq) => { try { window.open(await urlTemporaria(a.path), "_blank", "noopener"); } catch (e) { erro(e); } };
  const remover = async (a: Arq) => {
    try { await sb().storage.from("empresa").remove([a.path]); await q(sb().from("produto_arquivos").delete().eq("id", a.id)); recarregar(); } catch (e) { erro(e); }
  };
  return (
    <div className="space-y-3">
      {pode && <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-6 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800", enviando && "opacity-50")}>
        <Upload className="h-4 w-4" /> {enviando ? "Enviando…" : "Enviar fotos, STL, 3MF, STEP, G-code, .zip ou PDF (até 50 MB)"}
        <input type="file" multiple disabled={enviando} accept=".stl,.3mf,.obj,.step,.stp,.gcode,.zip,.png,.jpg,.jpeg,.webp,.pdf" className="hidden" onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} />
      </label>}
      <p className="text-xs text-slate-500">Os arquivos ficam privados. Os links de download valem por 10 minutos.</p>
      {!dados?.length ? <Empty texto="Nenhum arquivo" /> : (
        <Table head={["Arquivo", "Tipo", "Tamanho", "Enviado em", ""]}>
          {dados.map((a) => (
            <tr key={a.id}><Td><button onClick={() => abrir(a)} className="flex items-center gap-1 text-brand-700 hover:underline"><Paperclip className="h-3.5 w-3.5" /> {a.nome}</button></Td>
              <Td>{a.tipo === "foto" ? "Foto" : a.tipo === "modelo" ? "Modelo 3D" : "Documento"}</Td><Td className="tnum">{a.tamanho ? `${num(a.tamanho / 1048576, 2)} MB` : "—"}</Td><Td>{dataHora(a.created_at)}</Td>
              <Td><div className="flex justify-end gap-1"><button onClick={() => abrir(a)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Baixar"><FileDown className="h-4 w-4" /></button>
                {pode && <button onClick={() => remover(a)} className="rounded p-1.5 text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>}</div></Td></tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Precos({ produtoId, verCusto }: { produtoId: string; verCusto: boolean }) {
  const { dados } = useDados(() => q<{ id: number; preco_anterior: number | null; preco_novo: number; custo_anterior: number | null; custo_novo: number; created_at: string }[]>(
    sb().from("produto_precos").select("*").eq("produto_id", produtoId).order("created_at", { ascending: false }).limit(100)), [produtoId]);
  if (!dados?.length) return <Empty texto="Sem histórico" />;
  return (
    <Table head={["Quando", "Preço", verCusto ? "Custo" : ""]}>
      {dados.map((h) => (
        <tr key={h.id}><Td>{dataHora(h.created_at)}</Td><Td className="tnum">{h.preco_anterior != null ? `${brl(h.preco_anterior)} → ` : ""}{brl(h.preco_novo)}</Td>
          <Td className="tnum">{verCusto ? `${h.custo_anterior != null ? `${brl(h.custo_anterior)} → ` : ""}${brl(h.custo_novo)}` : ""}</Td></tr>
      ))}
    </Table>
  );
}
