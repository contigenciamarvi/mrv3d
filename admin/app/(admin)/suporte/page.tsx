"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, RefreshCw, Send, Star, UserCheck } from "lucide-react";
import { sb, rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { dataHora, cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Loading, Modal, Select, Table, Td, Textarea } from "@/components/ui";

type Chamado = { id: string; numero: number; empresa_id: string; empresa: string; assunto: string; categoria: string; prioridade: string; status: string; atribuido: string | null;
  ultima_mensagem_em: string; ultima_mensagem_de: string; mensagens: number; created_at: string; avaliacao: number | null };
type Msg = { id: number; autor_tipo: string; autor_nome: string | null; texto: string; interno: boolean; created_at: string };

const SITUACAO: Record<string, string> = { aberto: "Aberto", em_atendimento: "Em atendimento", aguardando_cliente: "Aguardando a loja", resolvido: "Resolvido", fechado: "Fechado" };
const CATEGORIA: Record<string, string> = { duvida: "Dúvida", problema: "Problema", financeiro: "Financeiro", sugestao: "Sugestão", outro: "Outro" };
const PRIORIDADE: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
const tomS = (s: string) => (({ aberto: "amarelo", em_atendimento: "azul", aguardando_cliente: "cinza", resolvido: "verde", fechado: "cinza" }) as Record<string, "amarelo" | "azul" | "verde" | "cinza">)[s] || "cinza";
const tomP = (p: string) => (p === "urgente" ? "vermelho" : p === "alta" ? "amarelo" : "cinza");

export default function SuportePlataforma() {
  const [filtro, setFiltro] = useState("abertos");
  const [lista, setLista] = useState<Chamado[] | null>(null);
  const [falha, setFalha] = useState("");
  const [aberto, setAberto] = useState<Chamado | null>(null);
  const carregar = useCallback(async () => {
    setFalha("");
    try { setLista(await rpc<Chamado[]>("admin_chamados", { p_status: filtro === "todos" ? null : filtro })); } catch (e) { setFalha((e as Error).message); }
  }, [filtro]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, [carregar]);
  const l = lista || [];
  const esperando = l.filter((c) => c.ultima_mensagem_de === "loja" && ["aberto", "em_atendimento"].includes(c.status));

  return (
    <>
      <PageHeader titulo="Suporte" sub="Chamados abertos pelas lojas. A loja vê só as respostas; notas internas ficam com a equipe."
        acoes={<div className="flex gap-2"><Select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtro">
          <option value="abertos">Em andamento</option><option value="aberto">Abertos</option><option value="aguardando_cliente">Aguardando a loja</option>
          <option value="resolvido">Resolvidos</option><option value="fechado">Fechados</option><option value="todos">Todos</option></Select>
          <Button variant="secondary" onClick={carregar}><RefreshCw className="h-4 w-4" /></Button></div>} />
      {falha && <ErrorBox erro={falha} />}
      {lista && filtro === "abertos" && <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Esperando resposta da equipe" valor={esperando.length} tom={esperando.length ? "vermelho" : undefined} />
        <Kpi label="Urgentes / alta" valor={l.filter((c) => ["urgente", "alta"].includes(c.prioridade)).length} />
        <Kpi label="Sem responsável" valor={l.filter((c) => !c.atribuido).length} />
        <Kpi label="Aguardando a loja" valor={l.filter((c) => c.status === "aguardando_cliente").length} />
      </div>}
      <Card>
        {!lista && !falha ? <Loading /> : !l.length ? <Empty texto="Nenhum chamado aqui" /> : (
          <Table head={["Nº", "Empresa", "Assunto", "Prioridade", "Situação", "Responsável", "Última mensagem"]}>{l.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setAberto(c)}>
              <Td className="tnum text-slate-500">#{c.numero}</Td><Td className="font-medium">{c.empresa}</Td>
              <Td><div>{c.assunto}</div><div className="text-xs text-slate-500">{CATEGORIA[c.categoria]} · {c.mensagens} mensagem(ns){c.avaliacao ? ` · ${"★".repeat(c.avaliacao)}` : ""}</div></Td>
              <Td><Badge tom={tomP(c.prioridade)}>{PRIORIDADE[c.prioridade]}</Badge></Td><Td><Badge tom={tomS(c.status)}>{SITUACAO[c.status]}</Badge></Td>
              <Td className="text-sm">{c.atribuido || <span className="text-slate-400">—</span>}</Td>
              <Td className={cn("text-sm", c.ultima_mensagem_de === "loja" && ["aberto", "em_atendimento"].includes(c.status) && "font-medium text-red-600")}>{dataHora(c.ultima_mensagem_em)}<div className="text-xs text-slate-500">{c.ultima_mensagem_de === "loja" ? "da loja" : "da equipe"}</div></Td>
            </tr>))}</Table>)}
      </Card>
      {aberto && <Atendimento c={aberto} onClose={() => { setAberto(null); carregar(); }} />}
    </>
  );
}

function Atendimento({ c, onClose }: { c: Chamado; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [atual, setAtual] = useState(c);
  const [texto, setTexto] = useState("");
  const [interno, setInterno] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const carregar = useCallback(async () => {
    const [m, ch] = await Promise.all([
      sb().from("chamado_mensagens").select("id,autor_tipo,autor_nome,texto,interno,created_at").eq("chamado_id", c.id).order("id"),
      rpc<Chamado[]>("admin_chamados", { p_status: null }),
    ]);
    if (m.error) { erro(m.error); return; }
    setMsgs(m.data as Msg[]);
    const x = ch.find((y) => y.id === c.id); if (x) setAtual(x);
  }, [c.id]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);
  const mudar = async (args: Record<string, unknown>, ok: string) => { try { await rpc("mudar_chamado", { p_chamado: c.id, ...args }); toast(ok); carregar(); } catch (e) { erro(e); } };

  return (
    <Modal aberto titulo={`#${atual.numero} · ${atual.assunto}`} onClose={onClose} largura="max-w-3xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{atual.empresa}</span><span className="text-slate-500">· {CATEGORIA[atual.categoria]} · aberto {dataHora(atual.created_at)}</span>
          {atual.avaliacao && <span className="flex items-center text-amber-500">{Array.from({ length: atual.avaliacao }).map((_, i) => <Star key={i} className="h-4 w-4 fill-amber-400" />)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={atual.status} onChange={(e) => mudar({ p_status: e.target.value }, "Situação alterada")} aria-label="Situação" className="w-48">{Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select value={atual.prioridade} onChange={(e) => mudar({ p_prioridade: e.target.value }, "Prioridade alterada")} aria-label="Prioridade" className="w-36">{Object.entries(PRIORIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Button variant="secondary" size="sm" onClick={() => mudar({ p_atribuir_a_mim: true }, "Chamado atribuído a você")}><UserCheck className="h-4 w-4" /> Assumir{atual.atribuido ? ` (hoje: ${atual.atribuido})` : ""}</Button>
        </div>
        <div className="max-h-[26rem] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          {!msgs ? <Loading /> : msgs.map((m) => (
            <div key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.interno ? "ml-auto border border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/30"
              : m.autor_tipo === "plataforma" ? "ml-auto bg-blue-600 text-white" : "bg-white shadow-sm dark:bg-slate-900")}>
              <div className={cn("mb-1 flex items-center gap-1 text-xs", m.autor_tipo === "plataforma" && !m.interno ? "text-blue-100" : "text-slate-500")}>
                {m.interno && <Lock className="h-3 w-3" />}{m.interno ? "Nota interna · " : ""}{m.autor_nome || (m.autor_tipo === "loja" ? "Loja" : "Equipe")} · {dataHora(m.created_at)}</div>
              <div className="whitespace-pre-wrap break-words">{m.texto}</div>
            </div>))}
          <div ref={fim} />
        </div>
        {atual.status === "fechado" ? <p className="text-sm text-slate-500">Chamado fechado. Reabra mudando a situação, se precisar.</p> : (
          <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!texto.trim()) return; setEnviando(true);
            try { await rpc("responder_chamado", { p_chamado: c.id, p_texto: texto, p_interno: interno }); setTexto(""); setInterno(false); carregar(); } catch (x) { erro(x); } finally { setEnviando(false); } }}>
            <Textarea rows={3} maxLength={5000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={interno ? "Nota interna (a loja não vê)" : "Resposta para a loja"}
              className={cn(interno && "border-amber-400 bg-amber-50 dark:bg-amber-950/20")} />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={interno} onChange={(e) => setInterno(e.target.checked)} /> Nota interna (só a equipe vê)</label>
              <Button type="submit" loading={enviando}><Send className="h-4 w-4" /> {interno ? "Salvar nota" : "Responder"}</Button>
            </div>
          </form>)}
      </div>
    </Modal>
  );
}
