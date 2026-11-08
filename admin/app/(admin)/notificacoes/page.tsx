"use client";
import { useCallback, useEffect, useState } from "react";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { sb, rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { dataHora, STATUS_ASSINATURA, cn } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Table, Td, Textarea } from "@/components/ui";

type Aviso = { id: string; titulo: string; texto: string; nivel: string; link: string | null; alvo: string; plano_id: string | null; empresa_id: string | null;
  status_assinatura: string | null; inicio: string; fim: string | null; ativo: boolean; created_at: string };
type Plano = { id: string; nome: string };
type Emp = { id: string; nome: string; status: string };

const NIVEL: Record<string, string> = { info: "Informação", alerta: "Atenção", erro: "Problema", sucesso: "Novidade" };
const tomN = (n: string) => (({ info: "azul", alerta: "amarelo", erro: "vermelho", sucesso: "verde" }) as Record<string, "azul" | "amarelo" | "vermelho" | "verde">)[n] || "cinza";
const paraLocal = (v: string | null) => { if (!v) return ""; const d = new Date(v); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const situacao = (a: Aviso) => !a.ativo ? "Desativado" : new Date(a.inicio) > new Date() ? "Agendado" : a.fim && new Date(a.fim) <= new Date() ? "Encerrado" : "No ar";

/** Avisos que aparecem no sino de notificações das lojas */
export default function Notificacoes() {
  const { papel } = useSessao();
  const pode = ["proprietario", "administrador", "suporte"].includes(papel || "");
  const [lista, setLista] = useState<Aviso[] | null>(null);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [falha, setFalha] = useState("");
  const [ed, setEd] = useState<Partial<Aviso> | null>(null);
  const [excluir, setExcluir] = useState<Aviso | null>(null);
  const carregar = useCallback(async () => {
    setFalha("");
    const [a, p] = await Promise.all([sb().from("avisos_plataforma").select("*").order("created_at", { ascending: false }).limit(200), sb().from("planos").select("id,nome").order("ordem")]);
    if (a.error) { setFalha(a.error.message); return; }
    setLista(a.data as Aviso[]); setPlanos((p.data || []) as Plano[]);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const alvoTexto = (a: Aviso) => a.alvo === "todas" ? "Todas as lojas" : a.alvo === "plano" ? `Plano ${planos.find((p) => p.id === a.plano_id)?.nome || "?"}`
    : a.alvo === "status" ? `Assinaturas: ${STATUS_ASSINATURA[a.status_assinatura || ""] || a.status_assinatura}` : `Loja: ${nomes[a.empresa_id || ""] || "empresa específica"}`;

  return (
    <>
      <PageHeader titulo="Notificações" sub="Avisos que aparecem no sino das lojas: manutenções, novidades, cobranças. Podem ir para todas, por plano, por situação da assinatura ou para uma loja."
        acoes={pode && <Button onClick={() => setEd({ nivel: "info", alvo: "todas", ativo: true })}><Plus className="h-4 w-4" /> Novo aviso</Button>} />
      {falha && <ErrorBox erro={falha} />}
      <Card>
        {!lista && !falha ? <Loading /> : !lista?.length ? <Empty texto="Nenhum aviso publicado" /> : (
          <Table head={["Aviso", "Para quem", "Período", "Situação", ""]}>{lista.map((a) => (
            <tr key={a.id}>
              <Td><div className="flex items-center gap-2"><Badge tom={tomN(a.nivel)}>{NIVEL[a.nivel]}</Badge><span className="font-medium">{a.titulo}</span></div><div className="mt-1 line-clamp-2 text-xs text-slate-500">{a.texto}</div></Td>
              <Td className="text-sm">{alvoTexto(a)}</Td>
              <Td className="text-xs">{dataHora(a.inicio)}<br />{a.fim ? `até ${dataHora(a.fim)}` : "sem fim"}</Td>
              <Td><Badge tom={situacao(a) === "No ar" ? "verde" : situacao(a) === "Agendado" ? "azul" : "cinza"}>{situacao(a)}</Badge></Td>
              <Td>{pode && <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={async () => { const { error } = await sb().from("avisos_plataforma").update({ ativo: !a.ativo }).eq("id", a.id); if (error) erro(error); else { toast(a.ativo ? "Aviso desativado" : "Aviso ativado"); carregar(); } }}>{a.ativo ? "Desativar" : "Ativar"}</Button>
                <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setEd(a)}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(a)}><Trash2 className="h-4 w-4" /></Button></div>}</Td>
            </tr>))}</Table>)}
      </Card>
      {ed && <Editor aviso={ed} planos={planos} onNome={(id, n) => setNomes((x) => ({ ...x, [id]: n }))} onClose={() => setEd(null)} onSalvo={() => { setEd(null); carregar(); }} />}
      <Modal aberto={!!excluir} titulo="Excluir aviso" onClose={() => setExcluir(null)}>
        <p className="text-sm">Excluir <b>{excluir?.titulo}</b>? Ele some do sino das lojas. Para só tirar do ar, use Desativar.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setExcluir(null)}>Cancelar</Button>
          <Button variant="danger" onClick={async () => { const { error } = await sb().from("avisos_plataforma").delete().eq("id", excluir!.id); if (error) erro(error); else { toast("Aviso excluído"); setExcluir(null); carregar(); } }}>Excluir</Button></div>
      </Modal>
    </>
  );
}

function Editor({ aviso, planos, onNome, onClose, onSalvo }: { aviso: Partial<Aviso>; planos: Plano[]; onNome: (id: string, nome: string) => void; onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ titulo: aviso.titulo || "", texto: aviso.texto || "", nivel: aviso.nivel || "info", link: aviso.link || "", alvo: aviso.alvo || "todas",
    plano_id: aviso.plano_id || planos[0]?.id || "", empresa_id: aviso.empresa_id || "", empresa_nome: "", status_assinatura: aviso.status_assinatura || "atrasada",
    inicio: paraLocal(aviso.inicio || null), fim: paraLocal(aviso.fim || null) });
  const [busca, setBusca] = useState("");
  const [achadas, setAchadas] = useState<Emp[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (f.alvo !== "empresa" || busca.trim().length < 2) { setAchadas([]); return; }
    const t = setTimeout(() => rpc<Emp[]>("admin_buscar_empresas", { p_busca: busca }).then(setAchadas).catch(() => setAchadas([])), 300);
    return () => clearTimeout(t);
  }, [busca, f.alvo]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.alvo === "empresa" && !f.empresa_id) return toast("Escolha a loja", "erro");
    if (f.link && !/^\/[A-Za-z0-9/_?=&.-]*$/.test(f.link) && !/^https:\/\//i.test(f.link)) return toast("Link: use um caminho do painel (ex.: /assinatura/) ou um endereço https://", "erro");
    setSalvando(true);
    const v = { titulo: f.titulo.trim(), texto: f.texto.trim(), nivel: f.nivel, link: f.link.trim() || null, alvo: f.alvo,
      plano_id: f.alvo === "plano" ? f.plano_id : null, empresa_id: f.alvo === "empresa" ? f.empresa_id : null, status_assinatura: f.alvo === "status" ? f.status_assinatura : null,
      inicio: f.inicio ? new Date(f.inicio).toISOString() : new Date().toISOString(), fim: f.fim ? new Date(f.fim).toISOString() : null };
    const { error } = aviso.id ? await sb().from("avisos_plataforma").update(v).eq("id", aviso.id) : await sb().from("avisos_plataforma").insert(v);
    setSalvando(false);
    if (error) return erro(error);
    if (f.alvo === "empresa" && f.empresa_nome) onNome(f.empresa_id, f.empresa_nome);
    toast(aviso.id ? "Aviso atualizado" : "Aviso publicado"); onSalvo();
  };

  return (
    <Modal aberto titulo={aviso.id ? "Editar aviso" : "Novo aviso"} onClose={onClose} largura="max-w-xl">
      <form className="space-y-3" onSubmit={salvar}>
        <Field label="Título"><Input required minLength={3} maxLength={120} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
        <Field label="Texto"><Textarea required minLength={3} maxLength={1000} rows={4} value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo"><Select value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value })}>{Object.entries(NIVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Link (opcional)" hint="Ex.: /assinatura/ ou https://…"><Input maxLength={300} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
        </div>
        <Field label="Para quem"><Select value={f.alvo} onChange={(e) => setF({ ...f, alvo: e.target.value })}>
          <option value="todas">Todas as lojas</option><option value="plano">Lojas de um plano</option><option value="status">Por situação da assinatura</option><option value="empresa">Uma loja específica</option></Select></Field>
        {f.alvo === "plano" && <Field label="Plano"><Select value={f.plano_id} onChange={(e) => setF({ ...f, plano_id: e.target.value })}>{planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</Select></Field>}
        {f.alvo === "status" && <Field label="Situação da assinatura"><Select value={f.status_assinatura} onChange={(e) => setF({ ...f, status_assinatura: e.target.value })}>
          {["teste", "ativa", "pendente", "atrasada", "suspensa"].map((s) => <option key={s} value={s}>{STATUS_ASSINATURA[s] || s}</option>)}</Select></Field>}
        {f.alvo === "empresa" && <Field label="Loja" hint={f.empresa_id ? `Escolhida: ${f.empresa_nome || "loja já definida"}` : "Digite parte do nome"}>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar loja" />
          {achadas.length > 0 && <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">{achadas.map((x) => (
            <li key={x.id}><button type="button" className={cn("w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800", f.empresa_id === x.id && "font-semibold")}
              onClick={() => { setF({ ...f, empresa_id: x.id, empresa_nome: x.nome }); setBusca(x.nome); setAchadas([]); }}>{x.nome} <span className="text-xs text-slate-500">{x.status}</span></button></li>))}</ul>}
        </Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Começa em" hint="Vazio = agora"><Input type="datetime-local" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></Field>
          <Field label="Termina em" hint="Vazio = até desativar"><Input type="datetime-local" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></Field>
        </div>
        <div className="flex items-center justify-between pt-2"><span className="flex items-center gap-1 text-xs text-slate-500"><Megaphone className="h-3.5 w-3.5" /> Aparece no sino das lojas em até 2 minutos.</span>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}>{aviso.id ? "Salvar" : "Publicar"}</Button></div></div>
      </form>
    </Modal>
  );
}
