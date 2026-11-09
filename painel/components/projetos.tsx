"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Search, FileText, Factory, Link2, Download, Archive, Trash2, Layers, Clock, Weight, Copy, GitBranch, ExternalLink, AlertTriangle } from "lucide-react";
import { useApp } from "@/components/shell";
import { sb, q, rpc, urlTemporaria, enviarArquivo } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { num, dataHora, erroMsg, numOuNull, cn } from "@/lib/utils";
import { importarArquivo, type Importado } from "@/lib/importar3d";
import { salvarNaBiblioteca, LICENCAS, ORIGENS, licencaDoArquivo, usoComercial, type Projeto } from "@/lib/biblioteca";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Aviso, Confirmar } from "@/components/ui";
import { useArquivoDoZip } from "@/components/escolha-zip";

const horas = (min: number | null) => (min ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}min` : "—");
const tomUso = (u: string) => (u === "permitido" ? "verde" : u === "proibido" ? "vermelho" : "amarelo") as "verde" | "vermelho" | "amarelo";
const USO: Record<string, string> = { permitido: "Uso comercial permitido", proibido: "Sem uso comercial", verificar: "Verificar licença" };

function Miniatura({ path, className }: { path: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (path) urlTemporaria(path, 3600).then(setUrl).catch(() => setUrl(null)); }, [path]);
  return <div className={cn("flex items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800", className)}>{url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <Layers className="h-8 w-8 text-slate-300" />}</div>;
}

// ------------------------------------------------------------------ biblioteca
export function Biblioteca({ origem, abrir }: { origem?: string; abrir?: string | null }) {
  const app = useApp();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState(origem || "");
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => { if (abrir) setAberto(abrir); }, [abrir]);
  const [arquivados, setArquivados] = useState(false);
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<Projeto[]>(sb().from("projetos_3d").select("*,produtos(nome)").eq("empresa_id", app.empresa.id)
    .order("created_at", { ascending: false }).limit(2000)), [app.empresa.id]);
  const lista = useMemo(() => (dados || []).filter((p) => (arquivados || !p.arquivado) && (!filtro || p.origem === filtro)
    && (!busca || `${p.nome} ${p.arquivo_nome || ""} ${p.autor || ""} ${p.tags.join(" ")} ${p.materiais.join(" ")}`.toLowerCase().includes(busca.toLowerCase()))), [dados, filtro, busca, arquivados]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Buscar por nome, arquivo, material, autor…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-56" aria-label="Origem"><option value="">Todas as origens</option>{Object.entries(ORIGENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <label className="flex items-center gap-1 text-sm text-slate-500"><input type="checkbox" checked={arquivados} onChange={(e) => setArquivados(e.target.checked)} className="accent-brand-600" /> arquivados</label>
      </div>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !lista.length ? <Empty texto="Nenhum projeto. Importe um .gcode.3mf, .3mf, .gcode ou .stl." /> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">{lista.map((p) => (
          <button key={p.id} onClick={() => setAberto(p.id)} className={cn("flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow dark:border-slate-800 dark:bg-slate-900", p.arquivado && "opacity-60")}>
            <Miniatura path={p.miniatura_path} className="aspect-[4/3] rounded-none" />
            <div className="flex flex-1 flex-col gap-1 p-3">
              <div className="line-clamp-2 font-medium">{p.nome}{p.versao > 1 && <span className="ml-1 text-xs text-slate-500">v{p.versao}</span>}</div>
              <div className="flex flex-wrap gap-1 text-xs"><Badge tom={p.origem === "makerworld" ? "azul" : "cinza"}>{p.origem === "makerworld" ? "MakerWorld" : p.formato || p.origem}</Badge>
                {p.uso_comercial !== "permitido" && <Badge tom={tomUso(p.uso_comercial)}>{USO[p.uso_comercial]}</Badge>}</div>
              <div className="mt-auto flex flex-wrap gap-x-3 pt-1 text-xs text-slate-500">
                {p.placas ? <span>{p.placas} placa(s)</span> : null}{p.tempo_estimado_min ? <span>{horas(p.tempo_estimado_min)}</span> : null}{p.peso_g ? <span>{num(p.peso_g, 1)} g</span> : null}
                {p.produtos?.nome && <span className="text-brand-700">→ {p.produtos.nome}</span>}
              </div>
            </div>
          </button>))}</div>)}
      {aberto && <DetalheProjeto id={aberto} onClose={() => setAberto(null)} onMudou={recarregar} />}
    </>
  );
}

type Vinc = { id: string; produto_id: string | null; orcamento_id: string | null; pedido_id: string | null; ordem_id: string | null; created_at: string;
  produtos: { nome: string } | null; orcamentos: { numero: number; titulo: string } | null; pedidos: { numero: number } | null; ordens_producao: { numero: number; status: string } | null };

function DetalheProjeto({ id, onClose, onMudou }: { id: string; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const router = useRouter();
  const edita = app.podeEscrever && (app.pode("produtos_editar") || app.pode("orcamentos_criar") || app.pode("producao_gerenciar"));
  const [ed, setEd] = useState<Partial<Projeto> | null>(null);
  const [op, setOp] = useState<{ qtd: string; impressora: string; pedido: string } | null>(null);
  const [prod, setProd] = useState<string | null>(null);
  const [versao, setVersao] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const { dados, erro: falha, recarregar } = useDados(async () => {
    const [[p], vinc, imps, prods, versoes] = await Promise.all([
      q<Projeto[]>(sb().from("projetos_3d").select("*,produtos(nome)").eq("id", id)),
      q<Vinc[]>(sb().from("projeto_vinculos").select("id,produto_id,orcamento_id,pedido_id,ordem_id,created_at,produtos(nome),orcamentos(numero,titulo),pedidos(numero),ordens_producao(numero,status)").eq("projeto_id", id).order("created_at", { ascending: false })),
      app.pode("impressoras_ver") ? q<{ id: string; nome: string }[]>(sb().from("impressoras").select("id,nome").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")) : Promise.resolve([]),
      app.pode("produtos_ver") ? q<{ id: string; nome: string }[]>(sb().from("produtos").select("id,nome").eq("empresa_id", app.empresa.id).eq("status", "ativo").order("nome")) : Promise.resolve([]),
      Promise.resolve(null as Projeto[] | null),
    ]);
    if (!p) throw new Error("Projeto não encontrado");
    const raiz = (p as Projeto & { projeto_raiz_id: string | null }).projeto_raiz_id || p.id;
    const vers = await q<(Projeto & { versao: number })[]>(sb().from("projetos_3d").select("id,nome,versao,created_at,arquivo_nome").or(`id.eq.${raiz},projeto_raiz_id.eq.${raiz}`).order("versao"));
    return { p: p as Projeto & { versao: number; projeto_raiz_id: string | null; copia_de: string | null }, vinc, imps, prods, versoes: versoes ?? vers };
  }, [id]);
  const p = dados?.p;
  const md = (p?.metadados || {}) as { placas?: { indice: number; nome: string | null; tempo_min: number | null; peso_g: number | null; objetos: string[]; filamentos: { slot: number; tipo: string | null; cor: string | null; peso_g: number | null }[] }[];
    configuracoes?: Record<string, string>; avisos?: string[]; peso_inclui_purga_suporte?: boolean; proveniencia?: Record<string, { status: string; fonte: string }> };
  const mudou = () => { recarregar(); onMudou(); };
  const acao = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); mudou(); return true; } catch (e) { erro(e); return false; } };
  const bloqueado = !!p && p.uso_comercial !== "permitido";

  return (
    <Modal aberto titulo={p ? p.nome : "Projeto"} onClose={onClose} largura="max-w-5xl">
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : !dados || !p ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-5">
            <Miniatura path={p.miniatura_path} className="h-44 w-44 shrink-0" />
            <div className="min-w-60 flex-1 space-y-2 text-sm">
              <div className="flex flex-wrap gap-1.5"><Badge tom="azul">{ORIGENS[p.origem]}</Badge>{p.formato && <Badge>{p.formato}</Badge>}<Badge>v{p.versao}</Badge>
                <Badge tom={tomUso(p.uso_comercial)}>{USO[p.uso_comercial]}</Badge>{p.arquivado && <Badge>Arquivado</Badge>}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <span className="flex items-center gap-1"><Layers className="h-4 w-4 text-slate-400" /> {p.placas ?? "—"} placa(s) · {p.pecas ?? "—"} objeto(s)</span>
                <span className="flex items-center gap-1"><Clock className="h-4 w-4 text-slate-400" /> {horas(p.tempo_estimado_min)}</span>
                <span className="flex items-center gap-1"><Weight className="h-4 w-4 text-slate-400" /> {p.peso_g != null ? `${num(p.peso_g, 2)} g` : "—"}</span>
                {p.impressora_modelo && <span>Impressora: {p.impressora_modelo}</span>}
                {p.altura_camada_mm && <span>Camada {num(p.altura_camada_mm, 2)} mm</span>}
                {p.bico_mm && <span>Bico {num(p.bico_mm, 2)} mm</span>}
                {p.preenchimento && <span>Preenchimento {p.preenchimento}</span>}
                {p.fatiador && <span>{p.fatiador}</span>}
                {p.dimensoes_mm?.length === 3 && <span>{p.dimensoes_mm.join(" × ")} mm</span>}
                {p.materiais.length > 0 && <span>Materiais: {p.materiais.join(", ")}</span>}
              </div>
              {p.cores.length > 0 && <div className="flex gap-1">{p.cores.map((c) => <span key={c} title={c} className="h-5 w-5 rounded-full border border-slate-300" style={{ background: c }} />)}</div>}
              {p.autor && <div>Autor: {p.autor}</div>}
              <div>Licença: {p.licenca ? LICENCAS[p.licenca] : "—"}</div>
              {p.makerworld_url && <a href={p.makerworld_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-700 underline"><ExternalLink className="h-3.5 w-3.5" /> Ver no MakerWorld</a>}
              {md.peso_inclui_purga_suporte && <p className="text-xs text-slate-500">Peso do fatiador já inclui suportes e purga.</p>}
              <div className="text-xs text-slate-500">Importado {dataHora(p.created_at)}{p.arquivo_nome ? ` · ${p.arquivo_nome}` : ""}{p.tamanho_bytes ? ` · ${num(p.tamanho_bytes / 1048576, 1)} MB` : ""}</div>
            </div>
          </div>
          {bloqueado && <Aviso tom="vermelho"><AlertTriangle className="mr-1 inline h-4 w-4" />{p.uso_comercial === "proibido"
            ? "A licença deste modelo não permite venda. Para usar em orçamento ou produção, compre uma licença comercial do autor e mude a licença (dono ou administrador)."
            : "Licença não confirmada. Para usar em orçamento ou produção, o dono ou um administrador precisa informar a licença do modelo."}</Aviso>}

          <div className="flex flex-wrap gap-2">
            {app.pode("orcamentos_criar") && <Button disabled={bloqueado} onClick={() => router.push(`/orcamentos/importar/?projeto=${p.id}`)}><FileText className="h-4 w-4" /> Usar no orçamento</Button>}
            {app.pode("producao_gerenciar") && app.podeEscrever && <Button variant="secondary" disabled={bloqueado} onClick={() => setOp({ qtd: "1", impressora: dados.imps[0]?.id || "", pedido: "" })}><Factory className="h-4 w-4" /> Criar ordem de produção</Button>}
            {app.pode("produtos_editar") && app.podeEscrever && <Button variant="secondary" disabled={bloqueado} onClick={() => setProd(p.produto_id || dados.prods[0]?.id || "")}><Link2 className="h-4 w-4" /> Vincular a produto</Button>}
            {p.arquivo_path && <Button variant="ghost" onClick={async () => { try { window.open(await urlTemporaria(p.arquivo_path!), "_blank"); } catch (e) { erro(e); } }}><Download className="h-4 w-4" /> Baixar arquivo</Button>}
            {edita && p.origem !== "makerworld" && <Button variant="ghost" onClick={() => setVersao(true)}><GitBranch className="h-4 w-4" /> Nova versão</Button>}
            {edita && <Button variant="ghost" onClick={() => setEd({ nome: p.nome, licenca: p.licenca, autor: p.autor, descricao: p.descricao, tags: p.tags })}>Editar</Button>}
            {edita && <Button variant="ghost" onClick={() => acao(() => q(sb().from("projetos_3d").update({ arquivado: !p.arquivado }).eq("id", p.id)), p.arquivado ? "Projeto restaurado" : "Projeto arquivado")}><Archive className="h-4 w-4" /> {p.arquivado ? "Restaurar" : "Arquivar"}</Button>}
            {edita && (app.pode("produtos_editar") || app.pode("producao_gerenciar")) && <Button variant="ghost" onClick={() => setExcluir(true)}><Trash2 className="h-4 w-4" /></Button>}
          </div>

          {(md.placas?.length ?? 0) > 0 && <div><h3 className="mb-2 text-sm font-semibold">Placas</h3>
            <Table head={["Placa", "Objetos", "Tempo", "Peso", "Filamentos"]}>{md.placas!.map((pl) => (
              <tr key={pl.indice}><Td>{pl.indice}{pl.nome ? ` · ${pl.nome}` : ""}</Td><Td className="max-w-60 text-xs">{pl.objetos.join(", ") || "—"}</Td><Td>{horas(pl.tempo_min)}</Td><Td className="tnum">{pl.peso_g != null ? `${num(pl.peso_g, 2)} g` : "—"}</Td>
                <Td><div className="flex flex-wrap gap-1">{pl.filamentos.map((f) => <span key={f.slot} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{f.cor && <span className="h-3 w-3 rounded-full border" style={{ background: f.cor }} />}{f.tipo} {f.peso_g != null ? `${num(f.peso_g, 1)} g` : ""}</span>)}</div></Td></tr>))}</Table></div>}

          {md.proveniencia && <div><h3 className="mb-2 text-sm font-semibold">Origem dos dados</h3>
            <div className="flex flex-wrap gap-1.5 text-xs">{Object.entries(md.proveniencia).map(([k, v]) => <Badge key={k} tom={v.status === "EXTRACTED" ? "verde" : v.status === "MANUAL" ? "azul" : "amarelo"}>{k}: {({ EXTRACTED: "extraído", MANUAL: "manual", MISSING: "ausente", UNVERIFIED: "não verificado" } as Record<string, string>)[v.status] || v.status}</Badge>)}</div></div>}

          {md.configuracoes && Object.keys(md.configuracoes).length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">Configurações do fatiamento</summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">{Object.entries(md.configuracoes).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="truncate">{v}</dd></div>)}</dl></details>}

          <div className="grid gap-4 md:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold">Usado em</h3>
              {!dados.vinc.length ? <p className="text-sm text-slate-500">Ainda não foi usado.</p> : <ul className="space-y-1 text-sm">{dados.vinc.map((v) => <li key={v.id}>
                {v.produtos && <Link className="text-brand-700 hover:underline" href={`/produtos/?id=${v.produto_id}`}>Produto: {v.produtos.nome}</Link>}
                {v.orcamentos && <Link className="text-brand-700 hover:underline" href={`/orcamentos/editar/?id=${v.orcamento_id}`}>Orçamento #{v.orcamentos.numero} · {v.orcamentos.titulo}</Link>}
                {v.pedidos && <Link className="text-brand-700 hover:underline" href={`/pedidos/?id=${v.pedido_id}`}>Pedido #{v.pedidos.numero}</Link>}
                {v.ordens_producao && <Link className="text-brand-700 hover:underline" href={`/producao/?id=${v.ordem_id}`}>OP-{v.ordens_producao.numero} ({v.ordens_producao.status})</Link>}
                <span className="ml-1 text-xs text-slate-400">{dataHora(v.created_at)}</span></li>)}</ul>}</div>
            <div><h3 className="mb-2 text-sm font-semibold">Versões</h3>
              <ul className="space-y-1 text-sm">{dados.versoes.map((v) => <li key={v.id} className={cn(v.id === p.id && "font-medium")}>v{v.versao} · {v.arquivo_nome || v.nome} <span className="text-xs text-slate-400">{dataHora(v.created_at)}</span></li>)}</ul></div>
          </div>
          {p.descricao && <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{p.descricao}</p>}

          <Modal aberto={!!ed} titulo="Editar projeto" onClose={() => setEd(null)}>
            {ed && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await acao(() => q(sb().from("projetos_3d").update({ nome: ed.nome, ...(ed.licenca !== p.licenca ? { licenca: ed.licenca } : {}), autor: ed.autor || null, descricao: ed.descricao || null, tags: ed.tags || [] }).eq("id", p.id)), "Projeto atualizado")) setEd(null); }}>
              <Field label="Nome"><Input required value={ed.nome || ""} onChange={(e) => setEd({ ...ed, nome: e.target.value })} /></Field>
              <Field label="Licença" hint={["dono", "admin"].includes(app.papel) ? "Define se o modelo pode ser usado em vendas (a troca fica no histórico)" : "Só o dono ou um administrador altera a licença"}><Select disabled={!["dono", "admin"].includes(app.papel)} value={ed.licenca || "outra"} onChange={(e) => setEd({ ...ed, licenca: e.target.value })}>{Object.entries(LICENCAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Autor"><Input value={ed.autor || ""} onChange={(e) => setEd({ ...ed, autor: e.target.value })} /></Field>
              <Field label="Etiquetas" hint="Separadas por vírgula"><Input value={(ed.tags || []).join(", ")} onChange={(e) => setEd({ ...ed, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })} /></Field>
              <Field label="Descrição"><Textarea value={ed.descricao || ""} onChange={(e) => setEd({ ...ed, descricao: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEd(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
            </form>}
          </Modal>
          <Modal aberto={!!op} titulo="Nova ordem de produção" onClose={() => setOp(null)}>
            {op && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const o = await rpc<string>("projeto_criar_ordem", { p_projeto: p.id, p_quantidade: numOuNull(op.qtd) || 1, p_pedido: null, p_impressora: op.impressora || null }); toast("Ordem criada"); router.push(`/producao/?id=${o}`); } catch (e2) { erro(e2); } }}>
              <Field label="Quantas impressões deste projeto?"><Input required inputMode="numeric" value={op.qtd} onChange={(e) => setOp({ ...op, qtd: e.target.value })} /></Field>
              <Field label="Impressora"><Select value={op.impressora} onChange={(e) => setOp({ ...op, impressora: e.target.value })}><option value="">Definir depois</option>{dados.imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
              <p className="text-xs text-slate-500">Peso e tempo previstos vêm do projeto (× quantidade). Escolha o material na ordem antes de liberar.</p>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOp(null)}>Cancelar</Button><Button type="submit">Criar ordem</Button></div>
            </form>}
          </Modal>
          <Modal aberto={prod !== null} titulo="Vincular a produto" onClose={() => setProd(null)}>
            {prod !== null && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (!prod) return; if (await acao(() => rpc("projeto_vincular", { p_projeto: p.id, p_tipo: "produto", p_ref: prod }), "Projeto vinculado ao produto")) setProd(null); }}>
              <Field label="Produto"><Select required value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Escolha…</option>{dados.prods.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</Select></Field>
              {(p.peso_g || p.tempo_estimado_min) && <Button type="button" variant="ghost" size="sm" onClick={async () => { if (!prod) return; await acao(() => q(sb().from("produtos").update({ peso_g: p.peso_g, tempo_h: p.tempo_estimado_min ? Math.round((p.tempo_estimado_min / 60) * 100) / 100 : null }).eq("id", prod)), "Peso e tempo aplicados ao produto"); }}>
                Aplicar peso ({num(p.peso_g || 0, 1)} g) e tempo ({horas(p.tempo_estimado_min)}) ao produto</Button>}
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setProd(null)}>Cancelar</Button><Button type="submit">Vincular</Button></div>
            </form>}
          </Modal>
          {versao && <Modal aberto titulo="Enviar nova versão" onClose={() => setVersao(false)} largura="max-w-4xl"><Importador raiz={p} onPronto={(nid) => { setVersao(false); onMudou(); toast("Nova versão importada"); if (nid) onClose(); }} /></Modal>}
          <Confirmar aberto={excluir} titulo="Excluir projeto" perigo confirmar="Excluir" onCancel={() => setExcluir(false)} texto="O projeto sai da biblioteca. Orçamentos e ordens já criados continuam com os valores que tinham."
            onOk={async () => { try { await q(sb().from("projetos_3d").delete().eq("id", p.id)); if (p.arquivo_path) await sb().storage.from("empresa").remove([p.arquivo_path, ...(p.miniatura_path ? [p.miniatura_path] : [])]); toast("Projeto excluído"); onMudou(); onClose(); } catch (e) { erro(e); } }} />
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ importador (biblioteca)
const PROV = (imp: Importado) => {
  const s = (v: unknown, fonte: string) => ({ status: v == null || (Array.isArray(v) && !v.length) ? "MISSING" : "EXTRACTED", fonte });
  const f = imp.tipo === "gcode" ? "cabeçalho do G-code" : imp.fatiado ? "slice_info.config" : "3MF do projeto";
  return { tempo: s(imp.tempo_total_min, f), peso: s(imp.peso_total_g, f), placas: s(imp.placas.length || null, "model_settings/slice_info"), filamentos: s(imp.filamentos, "project_settings/slice_info"),
    impressora: s(imp.impressora, "project_settings.config"), camada: s(imp.altura_camada_mm, "configuração do fatiamento"), miniatura: s(imp.miniatura, "plate_N.png") };
};

export function Importador({ raiz, onPronto }: { raiz?: Projeto | null; onPronto?: (id: string | null) => void }) {
  const app = useApp();
  const router = useRouter();
  const [imp, setImp] = useState<Importado | null>(null);
  const [nome, setNome] = useState("");
  const [manual, setManual] = useState({ tempo: "", peso: "" });
  const [licenca, setLicenca] = useState("propria");
  const [proc, setProc] = useState(false);
  const [falha, setFalha] = useState("");
  const [dup, setDup] = useState<Projeto | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pode = app.podeEscrever && (app.pode("produtos_editar") || app.pode("orcamentos_criar") || app.pode("producao_gerenciar"));

  const zip = useArquivoDoZip();
  const processar = async (f?: File) => {
    if (!f) return;
    setFalha(""); setProc(true); setImp(null); setDup(null);
    try {
      const escolhido = await zip.abrir(f);
      if (!escolhido) return;
      f = escolhido;
      const r = await importarArquivo(f);
      setImp(r); setNome(raiz?.nome || r.nome || f.name); setLicenca(licencaDoArquivo(r.licenca) || "propria");
      setManual({ tempo: "", peso: "" });
      const [ja] = await q<Projeto[]>(sb().from("projetos_3d").select("*").eq("empresa_id", app.empresa.id).eq("sha256", r.sha256).limit(1));
      setDup(ja || null);
    } catch (e) {
      const m = erroMsg(e); setFalha(m);
      rpc("registrar_evento_importacao", { p_empresa: app.empresa.id, p_tipo: "erro", p_mensagem: `${f.name}: ${m}` }).catch(() => undefined);
    } finally { setProc(false); }
  };

  const salvar = async (modo: "novo" | "copia" | "versao") => {
    if (!imp) return;
    setSalvando(true);
    try {
      const tempo = imp.tempo_total_min ?? numOuNull(manual.tempo);
      const peso = imp.peso_total_g ?? numOuNull(manual.peso);
      const comManual: Importado = { ...imp, tempo_total_min: tempo, peso_total_g: peso };
      const prov = { ...PROV(imp), ...(imp.tempo_total_min == null && tempo != null ? { tempo: { status: "MANUAL", fonte: "informado pelo usuário" } } : {}),
        ...(imp.peso_total_g == null && peso != null ? { peso: { status: "MANUAL", fonte: "informado pelo usuário" } } : {}) };
      let novoId: string;
      if (modo === "novo" && !raiz) {
        const r = await salvarNaBiblioteca(app.empresa.id, comManual, { nome, licenca });
        novoId = r.projeto.id;
        await q(sb().from("projetos_3d").update({ metadados: { ...(r.projeto.metadados || {}), proveniencia: prov } }).eq("id", novoId));
      } else {
        // cópia do mesmo arquivo ou nova versão: envia o arquivo e grava com o vínculo
        const path = await enviarArquivo(app.empresa.id, "projetos", imp.arquivo);
        let mini: string | null = null;
        if (imp.miniatura?.length) mini = await enviarArquivo(app.empresa.id, "projetos", new File([imp.miniatura as BlobPart], "miniatura.png", { type: "image/png" })).catch(() => null);
        const [p] = await q<{ id: string }[]>(sb().from("projetos_3d").insert({
          empresa_id: app.empresa.id, nome, origem: "upload", arquivo_path: path, arquivo_nome: imp.arquivo.name.slice(0, 200), formato: imp.tipo === "desconhecido" ? null : imp.tipo,
          tamanho_bytes: imp.arquivo.size, sha256: imp.sha256, miniatura_path: mini, pecas: imp.objetos, placas: imp.placas.length || null, tempo_estimado_min: tempo, peso_g: peso,
          materiais: Array.from(new Set(imp.filamentos.map((f) => f.tipo).filter(Boolean))), cores: Array.from(new Set(imp.filamentos.map((f) => f.cor).filter(Boolean))),
          impressora_modelo: imp.impressora, bico_mm: imp.bico_mm, altura_camada_mm: imp.altura_camada_mm, preenchimento: imp.preenchimento, fatiador: imp.fatiador,
          volume_cm3: imp.geometria?.volume_cm3 ?? null, dimensoes_mm: imp.geometria?.dimensoes_mm ?? null, autor: imp.designer, licenca, descricao: imp.descricao,
          projeto_raiz_id: raiz ? raiz.id : null, copia_de: modo === "copia" ? dup?.id : null, produto_id: raiz?.produto_id ?? null,
          metadados: { fatiado: imp.fatiado, suportes: imp.suportes, peso_inclui_purga_suporte: imp.peso_inclui_purga_suporte, configuracoes: imp.configuracoes, avisos: imp.avisos, proveniencia: prov,
            placas: imp.placas.map((pl) => ({ indice: pl.indice, nome: pl.nome, tempo_min: pl.tempo_min, peso_g: pl.peso_g, objetos: pl.objetos, filamentos: pl.filamentos, suportes: pl.suportes })), filamentos: imp.filamentos },
        }).select("id"));
        novoId = p.id;
      }
      toast("Projeto salvo na biblioteca");
      setImp(null);
      onPronto ? onPronto(novoId) : router.push(`/projetos/?id=${novoId}`);
    } catch (e) { erro(e); } finally { setSalvando(false); }
  };

  const mini = useMemo(() => imp?.miniatura ? URL.createObjectURL(new Blob([imp.miniatura as BlobPart], { type: "image/png" })) : null, [imp]);
  return (
    <div className="space-y-4">
      {zip.modal}
      {!imp && <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50", (proc || !pode) && "pointer-events-none opacity-60")}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); processar(e.dataTransfer.files[0]); }}>
        {proc ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
        <span className="text-base"><b className="text-brand-700">{proc ? "Lendo o arquivo…" : raiz ? `Nova versão de "${raiz.nome}"` : "Arraste o arquivo"}</b>{!proc && " ou clique"}</span>
        <span className="text-xs">.gcode.3mf · .3mf · .gcode · .stl · .obj · .step · .zip — até 200 MB. Lido no seu navegador; nada é executado.</span>
        <input type="file" accept=".3mf,.gcode,.stl,.obj,.step,.stp,.zip" className="hidden" disabled={proc || !pode} onChange={(e) => { processar(e.target.files?.[0]); e.target.value = ""; }} />
      </label>}
      {!pode && <Aviso tom="amarelo">Seu perfil não importa projetos.</Aviso>}
      {falha && <ErrorBox erro={falha} />}
      {imp && <Card>
        <div className="flex flex-wrap gap-5">
          <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">{mini ? <img src={mini} alt="" className="h-full w-full object-contain" /> : <Layers className="h-8 w-8 text-slate-300" />}</div>
          <div className="min-w-60 flex-1 space-y-3">
            <div className="text-xs text-slate-500">{imp.arquivo.name} · {num(imp.arquivo.size / 1048576, 1)} MB · tipo detectado: <b>{imp.tipo}</b>{imp.fatiador ? ` · ${imp.fatiador}` : ""}</div>
            {imp.arquivo.size > 200 * 1048576 && <Aviso tom="vermelho">O arquivo passa de 200 MB e não pode ser guardado. Exporte só as placas necessárias ou use um .gcode.3mf menor.</Aviso>}
            <Grid>
              <Field label="Nome do projeto"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
              <Field label="Licença"><Select value={licenca} onChange={(e) => setLicenca(e.target.value)}>{Object.entries(LICENCAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Tempo estimado (min)" hint={imp.tempo_total_min != null ? "Extraído do arquivo" : "Não veio no arquivo: informe"}>
                <Input disabled={imp.tempo_total_min != null} value={imp.tempo_total_min != null ? String(imp.tempo_total_min).replace(".", ",") : manual.tempo} onChange={(e) => setManual({ ...manual, tempo: e.target.value })} /></Field>
              <Field label="Peso total (g)" hint={imp.peso_total_g != null ? "Extraído (inclui suportes e purga)" : "Não veio no arquivo: informe"}>
                <Input disabled={imp.peso_total_g != null} value={imp.peso_total_g != null ? String(imp.peso_total_g).replace(".", ",") : manual.peso} onChange={(e) => setManual({ ...manual, peso: e.target.value })} /></Field>
            </Grid>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(PROV(imp)).map(([k, v]) => <Badge key={k} tom={v.status === "EXTRACTED" ? "verde" : "amarelo"}>{k}: {v.status === "EXTRACTED" ? "extraído" : "ausente"}</Badge>)}
              {imp.placas.length > 0 && <Badge tom="azul">{imp.placas.length} placa(s) · {imp.objetos ?? 0} objeto(s)</Badge>}
              {imp.filamentos.map((f) => <span key={f.slot} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{f.cor && <span className="h-3 w-3 rounded-full border" style={{ background: f.cor }} />}{f.tipo || `Filamento ${f.slot}`}{f.peso_g != null ? ` ${num(f.peso_g, 1)} g` : ""}</span>)}
            </div>
            {imp.avisos.map((a, i) => <Aviso key={i} tom="amarelo">{a}</Aviso>)}
            {usoComercial(licenca) === "verificar" && <Aviso tom="amarelo">Licença não confirmada: o projeto fica na biblioteca, mas só vai para orçamento ou produção depois que a licença for informada.</Aviso>}
            {usoComercial(licenca) === "proibido" && <Aviso tom="vermelho">Licença sem uso comercial: o projeto fica na biblioteca, mas não poderá ir para orçamento ou produção até você registrar uma licença comercial.</Aviso>}
            {dup && !raiz && <Aviso tom="amarelo">Este mesmo arquivo já está na biblioteca como <b>{dup.nome}</b>. Escolha: reutilizar o existente, importar como cópia separada ou enviar como nova versão dele.</Aviso>}
            <div className="flex flex-wrap gap-2">
              {raiz ? <Button loading={salvando} disabled={imp.arquivo.size > 200 * 1048576 || dup?.id === raiz.id} onClick={() => salvar("versao")}><GitBranch className="h-4 w-4" /> Salvar como nova versão</Button>
                : dup ? <>
                  <Button onClick={() => onPronto ? onPronto(dup.id) : router.push(`/projetos/?id=${dup.id}`)}>Reutilizar o existente</Button>
                  <Button variant="secondary" loading={salvando} disabled={imp.arquivo.size > 200 * 1048576} onClick={() => salvar("copia")}><Copy className="h-4 w-4" /> Importar como cópia</Button>
                </> : <Button loading={salvando} disabled={imp.arquivo.size > 200 * 1048576} onClick={() => salvar("novo")}>Salvar na biblioteca</Button>}
              {app.pode("orcamentos_criar") && !raiz && <Link href="/orcamentos/importar/"><Button variant="ghost">Usar direto no orçamento</Button></Link>}
              <Button variant="ghost" onClick={() => { setImp(null); setDup(null); }}>Trocar arquivo</Button>
            </div>
          </div>
        </div>
      </Card>}
    </div>
  );
}

// ------------------------------------------------------------------ MakerWorld (referência)
export function MakerWorld() {
  const app = useApp();
  const pode = app.podeEscrever && (app.pode("produtos_editar") || app.pode("orcamentos_criar") || app.pode("producao_gerenciar"));
  const [f, setF] = useState({ url: "", nome: "", autor: "", licenca: "sdfl", descricao: "" });
  const [arq, setArq] = useState<Importado | null>(null);
  const [lendo, setLendo] = useState(false);
  const zipMw = useArquivoDoZip();
  const [salvando, setSalvando] = useState(false);
  const [lista, setLista] = useState(0);
  const urlOk = /^https:\/\/(www\.)?makerworld\.com(\.cn)?\/.+/i.test(f.url.trim());
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      let path: string | null = null, mini: string | null = null;
      if (arq) {
        path = await enviarArquivo(app.empresa.id, "projetos", arq.arquivo);
        if (arq.miniatura?.length) mini = await enviarArquivo(app.empresa.id, "projetos", new File([arq.miniatura as BlobPart], "miniatura.png", { type: "image/png" })).catch(() => null);
      }
      await q(sb().from("projetos_3d").insert({ empresa_id: app.empresa.id, nome: f.nome || arq?.nome || "Modelo do MakerWorld", origem: "makerworld", makerworld_url: f.url.trim(), autor: f.autor || arq?.designer || null,
        licenca: f.licenca, descricao: f.descricao || null, arquivo_path: path, arquivo_nome: arq?.arquivo.name ?? null, formato: arq && arq.tipo !== "desconhecido" ? arq.tipo : null, tamanho_bytes: arq?.arquivo.size ?? null,
        sha256: arq?.sha256 ?? null, miniatura_path: mini, pecas: arq?.objetos ?? null, placas: arq?.placas.length || null, tempo_estimado_min: arq?.tempo_total_min ?? null, peso_g: arq?.peso_total_g ?? null,
        materiais: arq ? Array.from(new Set(arq.filamentos.map((x) => x.tipo).filter(Boolean))) : [], cores: arq ? Array.from(new Set(arq.filamentos.map((x) => x.cor).filter(Boolean))) : [],
        impressora_modelo: arq?.impressora ?? null, metadados: arq ? { placas: arq.placas.map((pl) => ({ indice: pl.indice, nome: pl.nome, tempo_min: pl.tempo_min, peso_g: pl.peso_g, objetos: pl.objetos, filamentos: pl.filamentos })), filamentos: arq.filamentos, licenca_no_arquivo: arq.licenca } : {} }));
      toast("Referência salva"); setF({ url: "", nome: "", autor: "", licenca: "sdfl", descricao: "" }); setArq(null); setLista((x) => x + 1);
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  return (
    <div className="space-y-6">
      {zipMw.modal}
      <Card><CardTitle>Guardar referência de modelo público</CardTitle>
        <Aviso>O MakerWorld não oferece integração oficial para terceiros, então nada é baixado automaticamente. Cole o link, confira a licença na página do modelo e, se quiser, anexe o arquivo que você baixou por lá. A licença padrão do MakerWorld (Standard Digital File License) permite só uso pessoal: para vender impressões, é preciso licença comercial do autor.</Aviso>
        <form className="mt-4 space-y-3" onSubmit={salvar}>
          <fieldset disabled={!pode} className="space-y-3">
            <Field label="Link do modelo" hint="https://makerworld.com/…"><Input required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} className={cn(f.url && !urlOk && "border-red-400")} /></Field>
            <Grid>
              <Field label="Nome"><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder={arq?.nome || ""} /></Field>
              <Field label="Autor"><Input value={f.autor} onChange={(e) => setF({ ...f, autor: e.target.value })} placeholder={arq?.designer || ""} /></Field>
            </Grid>
            <Field label="Licença do modelo (como está na página)"><Select value={f.licenca} onChange={(e) => setF({ ...f, licenca: e.target.value })}>{Object.entries(LICENCAS).filter(([k]) => k !== "propria").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Observações"><Textarea value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-700">{lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {arq ? `Arquivo: ${arq.arquivo.name}` : "Anexar o arquivo baixado (opcional)"}
              <input type="file" accept=".3mf,.gcode,.stl,.obj,.step,.stp,.zip" className="hidden" onChange={async (e) => { const a = e.target.files?.[0]; e.target.value = ""; if (!a) return; setLendo(true); try { const x = await zipMw.abrir(a); if (x) setArq(await importarArquivo(x)); } catch (x) { erro(x); } finally { setLendo(false); } }} /></label>
            <Button type="submit" loading={salvando} disabled={!urlOk}>Salvar referência</Button>
          </fieldset>
        </form>
      </Card>
      <Card><CardTitle>Modelos do MakerWorld na biblioteca</CardTitle><Biblioteca key={lista} origem="makerworld" /></Card>
    </div>
  );
}
