"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Play, Pause, CheckCircle2, AlertTriangle, Ban, PackageCheck, Upload, RotateCcw, Paperclip } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, enviarArquivo, urlTemporaria } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, hojeISO, numOuNull, STATUS_OP, PRIORIDADES, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Tabs, Kpi, Checkbox, Aviso } from "@/components/ui";

type Op = {
  id: string; numero: number; pedido_id: string | null; descricao: string; quantidade: number; impressora_id: string | null; material_id: string | null; cor: string | null;
  peso_previsto_g: number; tempo_previsto_h: number; inicio_previsto: string | null; prazo: string | null; operador_id: string | null; prioridade: string; status: string;
  observacoes: string | null; reserva_id: string | null; reimpressao_de: string | null; iniciada_em: string | null; horas_reais: number | null; consumo_real_g: number | null;
  perdas_g: number | null; consumo_registrado: boolean; custo_material: number; custo_energia: number; custo_maquina: number; custos_adicionais: number; custo_real_total: number;
  motivo_falha: string | null; concluida_em: string | null; updated_at: string; arquivo_path: string | null;
  pedidos: { numero: number; clientes: { nome: string } | null } | null; impressoras: { nome: string } | null; materiais: { nome: string; unidade: string } | null;
};
const SEL = "*, pedidos(numero, clientes(nome)), impressoras(nome), materiais(nome,unidade)";
const COLUNAS = ["planejada", "aguardando_material", "na_fila", "imprimindo", "pausada", "acabamento", "qualidade", "concluida", "falha"];
const PESO_PRIO: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
type Aba = "kanban" | "fila" | "calendario" | "lista";

export default function Producao() { return <Exige perm={["producao_gerenciar", "pedidos_ver"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.pode("producao_gerenciar") && app.podeEscrever;
  const idUrl = useParam("id");
  const [aba, setAba] = useState<Aba>("kanban");
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [busca, setBusca] = useState("");
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const desde = new Date(Date.now() - 14 * 86400000).toISOString();
    const [ops, imps, mats, equipe] = await Promise.all([
      q<Op[]>(sb().from("ordens_producao").select(SEL).eq("empresa_id", app.empresa.id)
        .or(`status.not.in.(concluida,cancelada,falha),updated_at.gte."${desde}"`).order("created_at", { ascending: false }).limit(2000)),
      q<{ id: string; nome: string; status: string }[]>(sb().from("impressoras").select("id,nome,status").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")),
      q<{ id: string; nome: string; unidade: string }[]>(sb().from("materiais").select("id,nome,unidade").eq("empresa_id", app.empresa.id).eq("ativo", true).in("categoria", ["filamento", "resina", "outro", "consumivel"]).order("nome")),
      rpc<{ user_id: string; email: string }[]>("equipe_listar", { p_empresa: app.empresa.id }).catch(() => []),
    ]);
    return { ops, imps, mats, equipe };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl) setAberta(idUrl); }, [idUrl]);

  const ops = useMemo(() => (dados?.ops || []).filter((o) => !busca.trim() || [o.descricao, `op-${o.numero}`, o.pedidos?.clientes?.nome, o.impressoras?.nome].some((v) => v?.toLowerCase().includes(busca.trim().toLowerCase())))
    .sort((a, b) => (PESO_PRIO[a.prioridade] - PESO_PRIO[b.prioridade]) || (a.prazo || "9").localeCompare(b.prazo || "9")), [dados, busca]);
  const conta = (s: string) => (dados?.ops || []).filter((o) => o.status === s).length;
  const hoje = hojeISO();

  const acao = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); recarregar(); } catch (e) { erro(e); } };
  const Cartao = ({ o }: { o: Op }) => (
    <div className={cn("rounded-lg border bg-white p-2 text-sm shadow-sm dark:bg-slate-800", o.prioridade === "urgente" ? "border-red-300" : o.prioridade === "alta" ? "border-amber-300" : "border-slate-200 dark:border-slate-700")}>
      <button className="w-full text-left" onClick={() => setAberta(o.id)}>
        <div className="flex items-center justify-between gap-1"><span className="font-medium">OP-{o.numero}</span>{o.prioridade !== "normal" && <Badge tom={o.prioridade === "urgente" ? "vermelho" : o.prioridade === "alta" ? "amarelo" : "cinza"}>{PRIORIDADES[o.prioridade]}</Badge>}</div>
        <div className="truncate">{o.descricao} · {num(o.quantidade)} un</div>
        <div className="text-xs text-slate-500">{[o.impressoras?.nome, o.materiais?.nome, o.pedidos && `Pedido ${o.pedidos.numero}`].filter(Boolean).join(" · ")}</div>
        {o.prazo && <div className={cn("text-xs", o.prazo < hoje && !["concluida", "cancelada"].includes(o.status) ? "font-medium text-red-600" : "text-slate-500")}>prazo {data(o.prazo)}</div>}
        {o.reimpressao_de && <div className="text-xs text-amber-700">reimpressão</div>}
      </button>
      {pode && <div className="mt-2 flex flex-wrap gap-1">
        {["planejada", "aguardando_material"].includes(o.status) && <Button size="sm" variant="secondary" onClick={() => acao(async () => { const r = await rpc<string>("liberar_ordem", { p_op: o.id }); if (r !== "na_fila") throw new Error("Sem matéria-prima suficiente: a ordem ficou aguardando material"); }, "Material reservado, ordem na fila")}>Liberar</Button>}
        {["na_fila", "pausada"].includes(o.status) && <Button size="sm" variant="secondary" onClick={() => acao(() => rpc("iniciar_ordem", { p_op: o.id }), "Impressão iniciada")}><Play className="h-3 w-3" /> {o.status === "pausada" ? "Retomar" : "Iniciar"}</Button>}
        {["imprimindo", "pausada", "acabamento", "qualidade"].includes(o.status) && <Button size="sm" variant="secondary" onClick={() => setAberta(o.id)}>Abrir</Button>}
      </div>}
    </div>
  );

  return (
    <>
      <PageHeader titulo="Ordens de Produção" sub="Do planejamento à peça pronta: reserva, consumo real e custo de cada impressão"
        acoes={pode && <Button onClick={() => setNova(true)}><Plus className="h-4 w-4" /> Nova ordem</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Na fila" valor={conta("na_fila")} /><Kpi label="Imprimindo" valor={conta("imprimindo")} />
        <Kpi label="Acabamento / qualidade" valor={conta("acabamento") + conta("qualidade")} />
        <Kpi label="Aguardando material" valor={conta("aguardando_material")} tom={conta("aguardando_material") ? "vermelho" : undefined} />
        <Kpi label="Falhas (14 dias)" valor={conta("falha")} tom={conta("falha") ? "vermelho" : undefined} />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs abas={[["kanban", "Quadro"], ["fila", "Fila por impressora"], ["calendario", "Calendário"], ["lista", "Lista"]]} ativa={aba} onChange={setAba} />
        <Input placeholder="Buscar ordem, cliente, impressora" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-64" aria-label="Buscar" />
      </div>
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : (
        <>
          {aba === "kanban" && <div className="flex gap-3 overflow-x-auto pb-4">
            {COLUNAS.map((s) => { const l = ops.filter((o) => o.status === s); return (
              <div key={s} className="w-60 shrink-0 rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
                <div className="mb-2 flex justify-between px-1 text-sm font-semibold"><span>{STATUS_OP[s]}</span><span className="text-slate-500">{l.length}</span></div>
                <div className="space-y-2">{l.map((o) => <Cartao key={o.id} o={o} />)}{!l.length && <div className="px-1 text-xs text-slate-400">—</div>}</div>
              </div>); })}
          </div>}
          {aba === "fila" && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...(dados?.imps || []), { id: "", nome: "Sem impressora definida", status: "" }].map((i) => {
              const l = ops.filter((o) => (o.impressora_id || "") === i.id && ["planejada", "aguardando_material", "na_fila", "imprimindo", "pausada"].includes(o.status))
                .sort((a, b) => (a.status === "imprimindo" ? -1 : b.status === "imprimindo" ? 1 : 0));
              if (!i.id && !l.length) return null;
              const horas = l.reduce((s, o) => s + o.tempo_previsto_h, 0);
              return (
                <Card key={i.id || "sem"}><div className="mb-2 flex items-center justify-between"><span className="font-semibold">{i.nome}</span>{i.status && <Badge tom={tomStatus(i.status)}>{i.status}</Badge>}</div>
                  <p className="mb-2 text-xs text-slate-500">{l.length} ordem(ns) · {num(horas, 1)} h previstas</p>
                  <div className="space-y-2">{l.map((o) => <Cartao key={o.id} o={o} />)}{!l.length && <Empty texto="Fila vazia" />}</div></Card>);
            })}
          </div>}
          {aba === "calendario" && <Calendario ops={ops} onAbrir={setAberta} />}
          {aba === "lista" && <Card>{!ops.length ? <Empty texto="Nenhuma ordem" /> : <Table head={["Ordem", "Pedido", "Impressora", "Prazo", "Situação", app.pode("custos_ver") ? "Custo real" : ""]}>
            {ops.map((o) => <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setAberta(o.id)}>
              <Td><div className="font-medium">OP-{o.numero} {o.descricao}</div><div className="text-xs text-slate-500">{num(o.quantidade)} un · {num(o.peso_previsto_g)} g · {num(o.tempo_previsto_h, 1)} h</div></Td>
              <Td>{o.pedidos ? `${o.pedidos.numero} · ${o.pedidos.clientes?.nome || ""}` : "—"}</Td><Td>{o.impressoras?.nome || "—"}</Td>
              <Td className={cn(o.prazo && o.prazo < hoje && !["concluida", "cancelada"].includes(o.status) && "text-red-600")}>{data(o.prazo)}</Td>
              <Td><Badge tom={tomStatus(o.status)}>{STATUS_OP[o.status]}</Badge></Td><Td className="tnum">{app.pode("custos_ver") && o.custo_real_total > 0 ? brl(o.custo_real_total) : ""}</Td></tr>)}
          </Table>}<p className="mt-3 text-xs text-slate-500">Mostra ordens em andamento e as encerradas nos últimos 14 dias.</p></Card>}
        </>
      )}
      {nova && dados && <NovaOrdem imps={dados.imps} mats={dados.mats} onClose={() => setNova(false)} onCriada={(id) => { setNova(false); recarregar(); setAberta(id); }} />}
      {aberta && dados && <Detalhe id={aberta} imps={dados.imps} mats={dados.mats} equipe={dados.equipe} onClose={() => { setAberta(null); if (idUrl) history.replaceState(null, "", "/producao/"); }} onMudou={recarregar} onAbrir={setAberta} />}
    </>
  );
}

function Calendario({ ops, onAbrir }: { ops: Op[]; onAbrir: (id: string) => void }) {
  const [inicio, setInicio] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; });
  const dias = Array.from({ length: 14 }, (_, i) => { const d = new Date(inicio); d.setDate(d.getDate() + i); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
  const semData = ops.filter((o) => !o.prazo && !["concluida", "cancelada", "falha"].includes(o.status));
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between"><span className="text-sm text-slate-500">Ordens pelo prazo final</span>
        <div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setInicio(new Date(inicio.getTime() - 7 * 86400000))}>‹ Semana</Button><Button size="sm" variant="secondary" onClick={() => setInicio(new Date(inicio.getTime() + 7 * 86400000))}>Semana ›</Button></div></div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {dias.map((d) => { const l = ops.filter((o) => o.prazo === d && o.status !== "cancelada"); const hoje = d === hojeISO(); return (
          <div key={d} className={cn("min-h-24 rounded-lg border p-1", hoje ? "border-brand-500" : "border-slate-200 dark:border-slate-700")}>
            <div className={cn("mb-1 font-medium", hoje && "text-brand-600")}>{new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}</div>
            {l.map((o) => <button key={o.id} onClick={() => onAbrir(o.id)} className={cn("mb-1 block w-full truncate rounded px-1 py-0.5 text-left", o.status === "concluida" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : o.status === "falha" ? "bg-red-100 text-red-800" : "bg-brand-50 text-brand-800 dark:bg-brand-500/20 dark:text-brand-300")}>OP-{o.numero} {o.descricao}</button>)}
          </div>); })}
      </div>
      {semData.length > 0 && <p className="mt-3 text-xs text-slate-500">{semData.length} ordem(ns) sem prazo definido.</p>}
    </Card>
  );
}

function NovaOrdem({ imps, mats, onClose, onCriada }: { imps: { id: string; nome: string }[]; mats: { id: string; nome: string }[]; onClose: () => void; onCriada: (id: string) => void }) {
  const app = useApp();
  const [f, setF] = useState({ descricao: "", quantidade: "1", impressora_id: "", material_id: "", cor: "", peso: "", tempo: "", prazo: hojeISO(app.config.prazo_padrao_dias), prioridade: "normal", observacoes: "" });
  return (
    <Modal aberto titulo="Nova ordem de produção" onClose={onClose} largura="max-w-2xl">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try {
        const r = await q<{ id: string }>(sb().from("ordens_producao").insert({ empresa_id: app.empresa.id, descricao: f.descricao, quantidade: numOuNull(f.quantidade) || 1, impressora_id: f.impressora_id || null,
          material_id: f.material_id || null, cor: f.cor || null, peso_previsto_g: numOuNull(f.peso) || 0, tempo_previsto_h: numOuNull(f.tempo) || 0, prazo: f.prazo || null, inicio_previsto: hojeISO(),
          prioridade: f.prioridade, observacoes: f.observacoes || null }).select("id").single());
        toast("Ordem criada"); onCriada(r.id); } catch (e2) { erro(e2); } }}>
        <Aviso>Ordens de pedidos são criadas automaticamente quando um orçamento vira pedido (ou pelo botão no pedido). Use esta opção para estoque ou peças internas.</Aviso>
        <Field label="O que produzir"><Input required value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
        <Grid cols={3}>
          <Field label="Quantidade"><Input inputMode="decimal" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} /></Field>
          <Field label="Impressora"><Select value={f.impressora_id} onChange={(e) => setF({ ...f, impressora_id: e.target.value })}><option value="">—</option>{imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
          <Field label="Material"><Select value={f.material_id} onChange={(e) => setF({ ...f, material_id: e.target.value })}><option value="">—</option>{mats.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field>
          <Field label="Peso total previsto (g)" hint="Todas as peças, do fatiador"><Input inputMode="decimal" value={f.peso} onChange={(e) => setF({ ...f, peso: e.target.value })} /></Field>
          <Field label="Tempo total previsto (h)"><Input inputMode="decimal" value={f.tempo} onChange={(e) => setF({ ...f, tempo: e.target.value })} /></Field>
          <Field label="Cor"><Input value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></Field>
          <Field label="Prazo"><Input type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} /></Field>
          <Field label="Prioridade"><Select value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}>{Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </Grid>
        <Field label="Observações"><Textarea value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit">Criar ordem</Button></div>
      </form>
    </Modal>
  );
}

function Detalhe({ id, imps, mats, equipe, onClose, onMudou, onAbrir }: {
  id: string; imps: { id: string; nome: string }[]; mats: { id: string; nome: string }[]; equipe: { user_id: string; email: string }[]; onClose: () => void; onMudou: () => void; onAbrir: (id: string) => void;
}) {
  const app = useApp();
  const pode = app.pode("producao_gerenciar") && app.podeEscrever;
  const verCusto = app.pode("custos_ver") || app.pode("producao_gerenciar");
  const [form, setForm] = useState<null | "finalizar" | "falha" | "cancelar" | "pausar">(null);
  const [fin, setFin] = useState({ horas: "", consumo: "", perdas: "", adicionais: "", obs: "" });
  const [fal, setFal] = useState({ horas: "", consumo: "", motivo: "", reimprimir: true });
  const [motivo, setMotivo] = useState("");
  const [p, setP] = useState<Record<string, string> | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { dados, carregando, recarregar } = useDados(async () => {
    const o = await q<Op>(sb().from("ordens_producao").select(SEL).eq("id", id).single());
    const [ev, fotos, reimp] = await Promise.all([
      q<{ id: number; status_anterior: string | null; status_novo: string; observacao: string | null; created_at: string }[]>(sb().from("producao_eventos").select("id,status_anterior,status_novo,observacao,created_at").eq("ordem_id", id).order("id")),
      q<{ id: string; path: string; nome: string }[]>(sb().from("ordem_fotos").select("id,path,nome").eq("ordem_id", id).order("created_at")),
      q<{ id: string; numero: number; status: string }[]>(sb().from("ordens_producao").select("id,numero,status").eq("reimpressao_de", id)),
    ]);
    return { o, ev, fotos, reimp };
  }, [id]);
  useEffect(() => {
    if (!dados) return; const o = dados.o;
    setP({ descricao: o.descricao, quantidade: String(o.quantidade), impressora_id: o.impressora_id || "", material_id: o.material_id || "", cor: o.cor || "",
      peso: String(o.peso_previsto_g).replace(".", ","), tempo: String(o.tempo_previsto_h).replace(".", ","), prazo: o.prazo || "", prioridade: o.prioridade, operador_id: o.operador_id || "", observacoes: o.observacoes || "" });
    setFin({ horas: String(o.tempo_previsto_h).replace(".", ","), consumo: String(o.peso_previsto_g).replace(".", ","), perdas: "", adicionais: "", obs: "" });
  }, [dados]);
  const mudou = () => { recarregar(); onMudou(); };
  const executar = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); setForm(null); mudou(); } catch (e) { erro(e); } };
  if (carregando && !dados) return <Modal aberto titulo="Ordem de produção" onClose={onClose}><Loading /></Modal>;
  if (!dados || !p) return null;
  const o = dados.o;
  const encerrada = ["concluida", "cancelada", "falha"].includes(o.status);
  const reservada = !!o.reserva_id && ["na_fila", "aguardando_material"].includes(o.status);
  const planejavel = pode && !encerrada && !["imprimindo", "pausada", "acabamento", "qualidade"].includes(o.status);

  return (
    <Modal aberto titulo={`OP-${o.numero} · ${o.descricao}`} onClose={onClose} largura="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tom={tomStatus(o.status)}>{STATUS_OP[o.status]}</Badge>
        {o.pedidos && <Link href={`/pedidos/?id=${o.pedido_id}`} className="text-sm text-brand-600 underline">Pedido {o.pedidos.numero}{o.pedidos.clientes ? ` · ${o.pedidos.clientes.nome}` : ""}</Link>}
        {o.reimpressao_de && <button onClick={() => onAbrir(o.reimpressao_de!)} className="text-sm text-amber-700 underline">Reimpressão de uma ordem que falhou</button>}
        {dados.reimp.map((r) => <button key={r.id} onClick={() => onAbrir(r.id)} className="text-sm text-amber-700 underline">Reimpressão: OP-{r.numero} ({STATUS_OP[r.status]})</button>)}
      </div>
      {pode && <div className="mb-4 flex flex-wrap gap-2">
        {["planejada", "aguardando_material"].includes(o.status) && <Button onClick={() => executar(async () => { const r = await rpc<string>("liberar_ordem", { p_op: id }); if (r !== "na_fila") throw new Error("Sem matéria-prima suficiente: a ordem ficou aguardando material. Registre uma compra e libere de novo."); }, "Material reservado")}><PackageCheck className="h-4 w-4" /> Liberar (reservar material)</Button>}
        {["planejada", "na_fila", "pausada"].includes(o.status) && <Button onClick={() => executar(() => rpc("iniciar_ordem", { p_op: id }), "Impressão iniciada")}><Play className="h-4 w-4" /> {o.status === "pausada" ? "Retomar impressão" : "Iniciar impressão"}</Button>}
        {o.status === "imprimindo" && <Button variant="secondary" onClick={() => { setMotivo(""); setForm("pausar"); }}><Pause className="h-4 w-4" /> Pausar</Button>}
        {["imprimindo", "pausada"].includes(o.status) && <Button onClick={() => setForm("finalizar")}><CheckCircle2 className="h-4 w-4" /> Impressão terminou</Button>}
        {o.status === "acabamento" && <Button variant="secondary" onClick={() => executar(() => rpc("avancar_ordem", { p_op: id, p_para: "qualidade", p_obs: null }), "Enviada para controle de qualidade")}>Acabamento pronto → qualidade</Button>}
        {["acabamento", "qualidade"].includes(o.status) && <Button onClick={() => executar(() => rpc("avancar_ordem", { p_op: id, p_para: "concluida", p_obs: null }), "Ordem concluída")}><CheckCircle2 className="h-4 w-4" /> Concluir</Button>}
        {["imprimindo", "pausada", "na_fila", "acabamento", "qualidade"].includes(o.status) && <Button variant="secondary" onClick={() => { setFal({ horas: "", consumo: "", motivo: "", reimprimir: true }); setForm("falha"); }}><AlertTriangle className="h-4 w-4 text-red-600" /> Registrar falha</Button>}
        {reservada && <Button variant="ghost" onClick={() => executar(() => rpc("replanejar_ordem", { p_op: id }), "Reserva liberada; ordem voltou para planejada")}><RotateCcw className="h-4 w-4" /> Voltar para planejada</Button>}
        {["planejada", "aguardando_material", "na_fila"].includes(o.status) && <Button variant="ghost" className="text-red-600" onClick={() => { setMotivo(""); setForm("cancelar"); }}><Ban className="h-4 w-4" /> Cancelar</Button>}
      </div>}
      {o.status === "aguardando_material" && <div className="mb-4"><Aviso tom="amarelo">Não há {o.materiais?.nome || "material"} disponível suficiente. Registre a compra em Compras e clique em Liberar de novo.</Aviso></div>}
      {o.status === "falha" && <div className="mb-4"><Aviso tom="vermelho">Falha: {o.motivo_falha}. O custo perdido ({brl(o.custo_real_total)}) fica somado ao custo do pedido.</Aviso></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try {
          await q(sb().from("ordens_producao").update({ descricao: p.descricao, quantidade: numOuNull(p.quantidade) || 1, impressora_id: p.impressora_id || null, material_id: p.material_id || null, cor: p.cor || null,
            peso_previsto_g: numOuNull(p.peso) || 0, tempo_previsto_h: numOuNull(p.tempo) || 0, prazo: p.prazo || null, prioridade: p.prioridade, operador_id: p.operador_id || null, observacoes: p.observacoes || null }).eq("id", id));
          toast("Ordem atualizada"); mudou(); } catch (e2) { erro(e2); } }}>
          <fieldset disabled={!planejavel} className="space-y-3">
            <Field label="Descrição"><Input value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} /></Field>
            <Grid cols={3}>
              <Field label="Quantidade"><Input inputMode="decimal" disabled={!!o.reserva_id} value={p.quantidade} onChange={(e) => setP({ ...p, quantidade: e.target.value })} /></Field>
              <Field label="Impressora"><Select value={p.impressora_id} onChange={(e) => setP({ ...p, impressora_id: e.target.value })}><option value="">—</option>{imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
              <Field label="Material"><Select disabled={!!o.reserva_id} value={p.material_id} onChange={(e) => setP({ ...p, material_id: e.target.value })}><option value="">—</option>{mats.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</Select></Field>
              <Field label="Peso total previsto (g)"><Input inputMode="decimal" disabled={!!o.reserva_id} value={p.peso} onChange={(e) => setP({ ...p, peso: e.target.value })} /></Field>
              <Field label="Tempo previsto (h)"><Input inputMode="decimal" value={p.tempo} onChange={(e) => setP({ ...p, tempo: e.target.value })} /></Field>
              <Field label="Cor"><Input value={p.cor} onChange={(e) => setP({ ...p, cor: e.target.value })} /></Field>
              <Field label="Prazo"><Input type="date" value={p.prazo} onChange={(e) => setP({ ...p, prazo: e.target.value })} /></Field>
              <Field label="Prioridade"><Select value={p.prioridade} onChange={(e) => setP({ ...p, prioridade: e.target.value })}>{Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Operador"><Select value={p.operador_id} onChange={(e) => setP({ ...p, operador_id: e.target.value })}><option value="">—</option>{equipe.map((u) => <option key={u.user_id} value={u.user_id}>{u.email}</option>)}</Select></Field>
            </Grid>
            <Field label="Observações"><Textarea value={p.observacoes} onChange={(e) => setP({ ...p, observacoes: e.target.value })} /></Field>
            {planejavel && <div className="flex justify-end"><Button type="submit" variant="secondary">Salvar dados</Button></div>}
          </fieldset>
          {o.reserva_id && reservada && <p className="text-xs text-slate-500">Material e peso ficam travados enquanto há reserva. Para mudar, use "Voltar para planejada".</p>}
        </form>
        <div className="space-y-4">
          {verCusto && <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
            <div className="mb-2 font-medium">{o.consumo_registrado ? "Custo real" : "Custo real (após a impressão)"}</div>
            {o.consumo_registrado ? <dl className="space-y-1">
              <div className="flex justify-between"><dt>Material ({num((o.consumo_real_g || 0) + (o.perdas_g || 0))} g)</dt><dd className="tnum">{brl(o.custo_material)}</dd></div>
              <div className="flex justify-between"><dt>Energia ({num(o.horas_reais, 1)} h)</dt><dd className="tnum">{brl(o.custo_energia)}</dd></div>
              <div className="flex justify-between"><dt>Máquina</dt><dd className="tnum">{brl(o.custo_maquina)}</dd></div>
              <div className="flex justify-between"><dt>Adicionais</dt><dd className="tnum">{brl(o.custos_adicionais)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold dark:border-slate-700"><dt>Total</dt><dd className="tnum">{brl(o.custo_real_total)}</dd></div>
              {(o.perdas_g || 0) > 0 && <div className="text-xs text-amber-700">{num(o.perdas_g)} g de perdas</div>}
            </dl> : <p className="text-slate-500">Previsto: {num(o.peso_previsto_g)} g · {num(o.tempo_previsto_h, 1)} h. O custo real é calculado ao registrar o fim da impressão.</p>}
          </div>}
          <div>
            <div className="mb-1 text-sm font-medium">Fotos da peça</div>
            <div className="space-y-1">{dados.fotos.map((f) => <button key={f.id} onClick={async () => { try { window.open(await urlTemporaria(f.path), "_blank", "noopener"); } catch (e) { erro(e); } }} className="flex items-center gap-1 text-sm text-brand-600 hover:underline"><Paperclip className="h-3 w-3" /> {f.nome}</button>)}</div>
            {pode && <label className={cn("mt-1 flex cursor-pointer items-center gap-1 text-sm text-slate-500 hover:underline", enviando && "opacity-50")}><Upload className="h-3.5 w-3.5" /> {enviando ? "Enviando…" : "Adicionar foto"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={enviando} onChange={async (e) => { const a = e.target.files?.[0]; if (!a) return; setEnviando(true); try { const path = await enviarArquivo(app.empresa.id, "producao", a); await q(sb().from("ordem_fotos").insert({ empresa_id: app.empresa.id, ordem_id: id, path, nome: a.name })); recarregar(); } catch (e2) { erro(e2); } finally { setEnviando(false); } }} /></label>}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Histórico</div>
            <ol className="space-y-1 text-xs">{dados.ev.map((e) => <li key={e.id}><span className="text-slate-500">{dataHora(e.created_at)}</span> · {e.status_novo ? STATUS_OP[e.status_novo] : ""}{e.observacao && <span className="text-slate-500"> — {e.observacao}</span>}</li>)}</ol>
            {o.concluida_em && <p className="mt-1 text-xs text-emerald-700">Concluída em {dataHora(o.concluida_em)}</p>}
          </div>
        </div>
      </div>

      <Modal aberto={form === "finalizar"} titulo="Impressão terminou" onClose={() => setForm(null)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); executar(() => rpc("finalizar_impressao", { p_op: id, p_horas: numOuNull(fin.horas), p_consumo_g: numOuNull(fin.consumo), p_perdas_g: numOuNull(fin.perdas) || 0, p_adicionais: numOuNull(fin.adicionais) || 0, p_obs: fin.obs || null }), "Consumo e custo real registrados"); }}>
          <p className="text-sm text-slate-500">Informe o que realmente foi gasto. O estoque é baixado uma única vez e o custo real vai para o pedido.</p>
          <Grid><Field label="Horas reais de impressão"><Input required inputMode="decimal" value={fin.horas} onChange={(e) => setFin({ ...fin, horas: e.target.value })} /></Field>
            <Field label="Material nas peças (g)"><Input required inputMode="decimal" value={fin.consumo} onChange={(e) => setFin({ ...fin, consumo: e.target.value })} /></Field>
            <Field label="Perdas (g)" hint="Purga, suportes, bordas"><Input inputMode="decimal" value={fin.perdas} onChange={(e) => setFin({ ...fin, perdas: e.target.value })} /></Field>
            <Field label="Custos adicionais (R$)"><Input inputMode="decimal" value={fin.adicionais} onChange={(e) => setFin({ ...fin, adicionais: e.target.value })} /></Field></Grid>
          <Field label="Observação"><Input value={fin.obs} onChange={(e) => setFin({ ...fin, obs: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Voltar</Button><Button type="submit">Registrar e ir para acabamento</Button></div>
        </form>
      </Modal>
      <Modal aberto={form === "falha"} titulo="Registrar falha de impressão" onClose={() => setForm(null)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); executar(async () => { const nova = await rpc<string | null>("registrar_falha", { p_op: id, p_horas: numOuNull(fal.horas) || 0, p_consumo_g: numOuNull(fal.consumo) || 0, p_motivo: fal.motivo, p_reimprimir: fal.reimprimir }); if (nova) onAbrir(nova); }, fal.reimprimir ? "Falha registrada e reimpressão criada" : "Falha registrada"); }}>
          <Field label="O que aconteceu"><Input required minLength={3} value={fal.motivo} onChange={(e) => setFal({ ...fal, motivo: e.target.value })} placeholder="Descolou da mesa, entupiu o bico…" /></Field>
          {!o.consumo_registrado && <Grid><Field label="Horas impressas até a falha"><Input inputMode="decimal" value={fal.horas} onChange={(e) => setFal({ ...fal, horas: e.target.value })} /></Field>
            <Field label="Material perdido (g)"><Input inputMode="decimal" value={fal.consumo} onChange={(e) => setFal({ ...fal, consumo: e.target.value })} /></Field></Grid>}
          <Checkbox label="Criar reimpressão vinculada" hint="Nova ordem com prioridade alta, ligada a esta" checked={fal.reimprimir} onChange={(v) => setFal({ ...fal, reimprimir: v })} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Voltar</Button><Button type="submit" variant="danger">Registrar falha</Button></div>
        </form>
      </Modal>
      <Modal aberto={form === "pausar" || form === "cancelar"} titulo={form === "pausar" ? "Pausar impressão" : "Cancelar ordem"} onClose={() => setForm(null)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); executar(() => rpc(form === "pausar" ? "pausar_ordem" : "cancelar_ordem", { p_op: id, p_motivo: motivo }), form === "pausar" ? "Impressão pausada" : "Ordem cancelada; reserva devolvida ao estoque"); }}>
          <Field label="Motivo"><Input required={form === "cancelar"} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Voltar</Button><Button type="submit" variant={form === "cancelar" ? "danger" : "primary"}>Confirmar</Button></div>
        </form>
      </Modal>
    </Modal>
  );
}
