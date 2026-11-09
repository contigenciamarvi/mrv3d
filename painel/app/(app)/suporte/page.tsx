"use client";
import { useEffect, useRef, useState } from "react";
import { LifeBuoy, Mail, MessageCircle, Plus, Send, Star } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { dataHora, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Table, Td, Loading, ErrorBox, Empty, Badge, Modal, Aviso } from "@/components/ui";

type Chamado = { id: string; numero: number; assunto: string; categoria: string; prioridade: string; status: string; ultima_mensagem_em: string; ultima_mensagem_de: string; avaliacao: number | null; created_at: string };
type Msg = { id: number; autor_tipo: string; autor_nome: string | null; texto: string; created_at: string };
type Plataforma = { nome: string; email_suporte: string | null; whatsapp_suporte: string | null; horario_suporte: string | null };

const SITUACAO: Record<string, string> = { aberto: "Aberto", em_atendimento: "Em atendimento", aguardando_cliente: "Aguardando você", resolvido: "Resolvido", fechado: "Fechado" };
const CATEGORIA: Record<string, string> = { duvida: "Dúvida", problema: "Problema", financeiro: "Financeiro / assinatura", sugestao: "Sugestão", outro: "Outro" };
const tom = (s: string) => (({ aberto: "amarelo", em_atendimento: "azul", aguardando_cliente: "vermelho", resolvido: "verde", fechado: "cinza" }) as Record<string, "amarelo" | "azul" | "vermelho" | "verde" | "cinza">)[s] || "cinza";

export default function Suporte() {
  const app = useApp();
  const idUrl = useParam("id");
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const { dados, erro: falha, carregando, recarregar } = useDados(async () => {
    const [lista, plat] = await Promise.all([
      q<Chamado[]>(sb().from("chamados").select("id,numero,assunto,categoria,prioridade,status,ultima_mensagem_em,ultima_mensagem_de,avaliacao,created_at").eq("empresa_id", app.empresa.id).order("ultima_mensagem_em", { ascending: false }).limit(200)),
      rpc<Plataforma>("plataforma_publica").catch(() => null),
    ]);
    return { lista, plat };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl) setAberto(idUrl); }, [idUrl]);
  const p = dados?.plat;

  return (
    <>
      <PageHeader titulo="Suporte" sub="Fale com a equipe da plataforma: dúvidas, problemas, assinatura e sugestões"
        acoes={app.podeEscrever && <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo chamado</Button>} />
      {p && (p.email_suporte || p.whatsapp_suporte) && <Card className="mb-4"><div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <LifeBuoy className="h-5 w-5 text-brand-700" />
        {p.whatsapp_suporte && <a className="flex items-center gap-1 text-brand-700 hover:underline" href={`https://wa.me/${p.whatsapp_suporte.length <= 11 ? "55" : ""}${p.whatsapp_suporte}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /> WhatsApp do suporte</a>}
        {p.email_suporte && <a className="flex items-center gap-1 text-brand-700 hover:underline" href={`mailto:${p.email_suporte}`}><Mail className="h-4 w-4" /> {p.email_suporte}</a>}
        {p.horario_suporte && <span className="text-slate-500">{p.horario_suporte}</span>}
      </div></Card>}
      {falha && <ErrorBox erro={falha} />}
      <Card>
        {carregando && !dados ? <Loading /> : !dados?.lista.length ? <Empty texto="Nenhum chamado. Abra um quando precisar de ajuda." /> : (
          <Table head={["Nº", "Assunto", "Categoria", "Situação", "Última mensagem"]}>{dados.lista.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setAberto(c.id)}>
              <Td className="tnum text-slate-500">#{c.numero}</Td>
              <Td><div className="font-medium">{c.assunto}</div>{c.ultima_mensagem_de === "plataforma" && c.status === "aguardando_cliente" && <div className="text-xs text-red-600">O suporte respondeu</div>}</Td>
              <Td>{CATEGORIA[c.categoria] || c.categoria}</Td><Td><Badge tom={tom(c.status)}>{SITUACAO[c.status] || c.status}</Badge></Td>
              <Td className="text-sm">{dataHora(c.ultima_mensagem_em)}</Td></tr>))}</Table>)}
      </Card>
      {novo && <NovoChamado onClose={() => setNovo(false)} onCriado={(id) => { setNovo(false); recarregar(); setAberto(id); }} />}
      {aberto && <Conversa id={aberto} onClose={() => { setAberto(null); if (idUrl) history.replaceState(null, "", "/suporte/"); recarregar(); }} />}
    </>
  );
}

function NovoChamado({ onClose, onCriado }: { onClose: () => void; onCriado: (id: string) => void }) {
  const app = useApp();
  const [f, setF] = useState({ assunto: "", categoria: "duvida", prioridade: "normal", texto: "" });
  const [salvando, setSalvando] = useState(false);
  return (
    <Modal aberto titulo="Novo chamado" onClose={onClose} largura="max-w-xl">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setSalvando(true);
        try { onCriado(await rpc<string>("abrir_chamado", { p_empresa: app.empresa.id, p_assunto: f.assunto, p_categoria: f.categoria, p_prioridade: f.prioridade, p_texto: f.texto })); toast("Chamado aberto: a equipe responde por aqui"); }
        catch (x) { erro(x); } finally { setSalvando(false); } }}>
        <Field label="Assunto"><Input required minLength={3} maxLength={150} value={f.assunto} onChange={(e) => setF({ ...f, assunto: e.target.value })} placeholder="Ex.: erro ao importar arquivo do Bambu Studio" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoria"><Select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}>{Object.entries(CATEGORIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Prioridade"><Select value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta (atrapalha o trabalho)</option></Select></Field>
        </div>
        <Field label="Descrição" hint="Conte o que você fez, o que esperava e o que aconteceu. Não envie senhas."><Textarea required minLength={3} maxLength={5000} rows={6} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}><Send className="h-4 w-4" /> Enviar</Button></div>
      </form>
    </Modal>
  );
}

function Conversa({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const { dados, erro: falha, recarregar } = useDados(async () => {
    const [[c], msgs] = await Promise.all([
      q<Chamado[]>(sb().from("chamados").select("id,numero,assunto,categoria,prioridade,status,ultima_mensagem_em,ultima_mensagem_de,avaliacao,created_at").eq("id", id)),
      q<Msg[]>(sb().from("chamado_mensagens").select("id,autor_tipo,autor_nome,texto,created_at").eq("chamado_id", id).order("id")),
    ]);
    return { c, msgs };
  }, [id]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [dados?.msgs.length]);
  const c = dados?.c;
  const acao = async (args: Record<string, unknown>, ok: string) => { try { await rpc("mudar_chamado", { p_chamado: id, ...args }); toast(ok); recarregar(); } catch (x) { erro(x); } };
  return (
    <Modal aberto titulo={c ? `#${c.numero} · ${c.assunto}` : "Chamado"} onClose={onClose} largura="max-w-2xl">
      {falha && <ErrorBox erro={falha} />}
      {!dados ? <Loading /> : !c ? <Empty texto="Chamado não encontrado" /> : <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tom={tom(c.status)}>{SITUACAO[c.status]}</Badge><span className="text-slate-500">{CATEGORIA[c.categoria]} · aberto em {dataHora(c.created_at)}</span></div>
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          {dados.msgs.map((m) => (
            <div key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.autor_tipo === "loja" ? "ml-auto bg-brand-600 text-zinc-950" : "bg-white shadow-sm dark:bg-slate-900")}>
              <div className={cn("mb-1 text-xs", m.autor_tipo === "loja" ? "text-blue-100" : "text-slate-500")}>{m.autor_tipo === "plataforma" ? `Suporte · ${m.autor_nome || ""}` : m.autor_nome} · {dataHora(m.created_at)}</div>
              <div className="whitespace-pre-wrap break-words">{m.texto}</div>
            </div>))}
          <div ref={fim} />
        </div>
        {c.status === "fechado" ? <Aviso>Chamado fechado. Se precisar, abra um novo.</Aviso> : app.podeEscrever && (
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!texto.trim()) return; setEnviando(true);
            try { await rpc("responder_chamado", { p_chamado: id, p_texto: texto }); setTexto(""); recarregar(); } catch (x) { erro(x); } finally { setEnviando(false); } }}>
            <Textarea rows={2} maxLength={5000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva sua mensagem" className="flex-1" />
            <Button type="submit" loading={enviando} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
          </form>)}
        {app.podeEscrever && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          {["resolvido", "fechado"].includes(c.status) ? (
            <div className="flex items-center gap-1 text-sm"><span className="mr-1 text-slate-500">Como foi o atendimento?</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} estrelas`} onClick={() => acao({ p_avaliacao: n }, "Obrigado pela avaliação")}>
                <Star className={cn("h-5 w-5", (c.avaliacao || 0) >= n ? "fill-amber-400 text-amber-400" : "text-slate-300")} /></button>)}</div>
          ) : <span />}
          {c.status === "resolvido" ? <Button variant="secondary" size="sm" onClick={() => acao({ p_status: "aberto" }, "Chamado reaberto")}>Reabrir</Button>
            : c.status !== "fechado" && <Button variant="secondary" size="sm" onClick={() => acao({ p_status: "resolvido" }, "Chamado marcado como resolvido")}>Meu problema foi resolvido</Button>}
        </div>}
      </div>}
    </Modal>
  );
}
