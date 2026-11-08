"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plug, LayoutGrid, List, Thermometer, Clock, Link2, Unplug, RefreshCw, Wifi, WifiOff, KeyRound, HelpCircle } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { num, dataHora, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, Aviso, Tabs, Confirmar } from "@/components/ui";

type Imp = { id: string; nome: string; fabricante: string | null; modelo: string | null; status: string; conexao_tipo: string; dispositivo_id: string | null; agente_id: string | null };
type Tel = { impressora_id: string; conexao: string; estado: string; trabalho_id: string | null; arquivo: string | null; progresso: number | null; decorrido_s: number | null; restante_s: number | null;
  camada: number | null; total_camadas: number | null; temp_bico: number | null; temp_bico_alvo: number | null; temp_mesa: number | null; temp_mesa_alvo: number | null; temp_camara: number | null;
  material: string | null; erro_codigo: string | null; fonte: string; medido_em: string; recebido_em: string; extras: { ams?: { tipo: string; cor: string }[] } };
type Agente = { id: string; nome: string; ativo: boolean; versao: string | null; ultimo_contato: string | null; dispositivos_detectados: { tipo_conexao: string; dispositivo_id: string; nome: string | null; modelo: string | null }[] };
type Trab = { id: string; impressora_id: string; chave: string; arquivo: string | null; status: string; iniciado_em: string; finalizado_em: string | null; duracao_s: number | null; progresso: number | null;
  ordem_id: string | null; sugestao_ordem_id: string | null; ordens_producao: { numero: number; descricao: string; tempo_previsto_h: number; status: string } | null };
type Op = { id: string; numero: number; descricao: string; impressora_id: string | null; status: string; prazo: string | null; tempo_previsto_h: number };
type Ev = { id: string; impressora_id: string; tipo: string; ocorrido_em: string; dados: Record<string, unknown> };

const CONEXOES: Record<string, string> = { bambu_lan: "Bambu Lab (rede local)", moonraker: "Klipper / Moonraker", octoprint: "OctoPrint" };
const ESTADO: Record<string, string> = { disponivel: "Disponível", preparando: "Preparando", imprimindo: "Imprimindo", pausada: "Pausada", finalizando: "Finalizando", concluida: "Concluída",
  cancelada: "Cancelada", falha: "Falha", erro: "Erro", desconhecido: "Desconhecido", manutencao: "Manutenção" };
const EVENTO: Record<string, string> = { conectada: "Conectada", desconectada: "Desconectada", erro_autenticacao: "Erro de autenticação", impressao_iniciada: "Impressão iniciada", impressao_pausada: "Pausada",
  impressao_retomada: "Retomada", impressao_concluida: "Impressão concluída", impressao_falhou: "Falha de impressão", impressao_cancelada: "Cancelada", temperatura_anormal: "Temperatura anormal", erro: "Erro" };
const ATRASO_S = 120; // sem dados há mais de 2 minutos = sem atualização recente
const tempo = (s: number | null) => (s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min` : `${Math.round(s / 60)} min`);

function situacao(i: Imp, t: Tel | undefined, agora: number): { con: string; conTom: "verde" | "amarelo" | "vermelho" | "cinza"; op: string; opTom: "verde" | "azul" | "amarelo" | "vermelho" | "cinza"; atual: boolean } {
  if (i.conexao_tipo === "nenhuma") return { con: "Não conectada", conTom: "cinza", op: i.status === "manutencao" ? "Manutenção" : "Sem monitoramento", opTom: "cinza", atual: false };
  if (!t) return { con: "Aguardando o agente", conTom: "amarelo", op: "Desconhecido", opTom: "cinza", atual: false };
  const idade = (agora - new Date(t.recebido_em).getTime()) / 1000;
  if (t.conexao === "erro_autenticacao") return { con: "Erro de autenticação", conTom: "vermelho", op: "Desconhecido", opTom: "cinza", atual: false };
  if (idade > 1800 || t.conexao === "offline") return { con: "Offline", conTom: "vermelho", op: "Desconhecido", opTom: "cinza", atual: false };
  if (idade > ATRASO_S) return { con: "Sem atualização recente", conTom: "amarelo", op: "Desconhecido", opTom: "cinza", atual: false };
  if (i.status === "manutencao") return { con: "Online", conTom: "verde", op: "Manutenção", opTom: "amarelo", atual: true };
  const tom = ({ imprimindo: "azul", preparando: "azul", pausada: "amarelo", finalizando: "azul", disponivel: "verde", concluida: "verde", falha: "vermelho", erro: "vermelho" } as Record<string, "verde" | "azul" | "amarelo" | "vermelho">)[t.estado] || "cinza";
  return { con: "Online", conTom: "verde", op: ESTADO[t.estado] || "Desconhecido", opTom: tom, atual: true };
}

export default function Monitoramento() { return <Exige perm={["impressoras_ver", "producao_gerenciar"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const trabUrl = useParam("trabalho");
  const [aba, setAba] = useState<"painel" | "trabalhos" | "eventos">("painel");
  const [modo, setModo] = useState<"cards" | "lista">("cards");
  const [filtro, setFiltro] = useState({ fab: "", situacao: "", busca: "" });
  const [conectar, setConectar] = useState<Imp | null>(null);
  const [desligar, setDesligar] = useState<Imp | null>(null);
  const [vincular, setVincular] = useState<Trab | null>(null);
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { if (trabUrl) setAba("trabalhos"); }, [trabUrl]);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [imps, tels, ags, trabs, ops, evs] = await Promise.all([
      q<Imp[]>(sb().from("impressoras").select("id,nome,fabricante,modelo,status,conexao_tipo,dispositivo_id,agente_id").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")),
      q<Tel[]>(sb().from("impressora_telemetria").select("*").eq("empresa_id", app.empresa.id)),
      q<Agente[]>(sb().from("agentes_locais").select("id,nome,ativo,versao,ultimo_contato,dispositivos_detectados").eq("empresa_id", app.empresa.id).eq("ativo", true)),
      q<Trab[]>(sb().from("impressora_trabalhos").select("*,ordens_producao!impressora_trabalhos_ordem_id_fkey(numero,descricao,tempo_previsto_h,status)").eq("empresa_id", app.empresa.id).order("iniciado_em", { ascending: false }).limit(200)),
      app.pode("producao_gerenciar") || app.pode("pedidos_ver") ? q<Op[]>(sb().from("ordens_producao").select("id,numero,descricao,impressora_id,status,prazo,tempo_previsto_h").eq("empresa_id", app.empresa.id)
        .in("status", ["planejada", "aguardando_material", "na_fila", "imprimindo", "pausada"]).order("numero")) : Promise.resolve([] as Op[]),
      q<Ev[]>(sb().from("impressora_eventos_integracao").select("id,impressora_id,tipo,ocorrido_em,dados").eq("empresa_id", app.empresa.id).order("ocorrido_em", { ascending: false }).limit(300)),
    ]);
    return { imps, tels, ags, trabs, ops, evs };
  }, [app.empresa.id]);
  // atualização automática (a cada 10 s)
  useEffect(() => { const t = setInterval(() => { setAgora(Date.now()); recarregar(); }, 10000); return () => clearInterval(t); }, [recarregar]);
  const tel = (id: string) => dados?.tels.find((t) => t.impressora_id === id);
  const nomeImp = (id: string) => dados?.imps.find((i) => i.id === id)?.nome || "—";
  const lista = useMemo(() => (dados?.imps || []).filter((i) => {
    const s = situacao(i, tel(i.id), agora);
    return (!filtro.fab || (i.fabricante || "").toLowerCase() === filtro.fab.toLowerCase() || i.conexao_tipo === filtro.fab)
      && (!filtro.situacao || (filtro.situacao === "online" ? s.con === "Online" : filtro.situacao === "offline" ? s.con !== "Online" && i.conexao_tipo !== "nenhuma" : filtro.situacao === "ativas" ? s.op === "Imprimindo" || s.op === "Pausada" : s.op === filtro.situacao))
      && (!filtro.busca || `${i.nome} ${i.modelo || ""}`.toLowerCase().includes(filtro.busca.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dados, filtro, agora]);
  const fabricantes = Array.from(new Set((dados?.imps || []).map((i) => i.fabricante).filter(Boolean))) as string[];
  const semOrdem = (dados?.trabs || []).filter((t) => !t.ordem_id && t.status !== "cancelado").length;

  return (
    <>
      <PageHeader titulo="Monitoramento de impressoras" sub="Estado em tempo real pelo agente local (somente leitura). Atualiza a cada 10 segundos."
        acoes={<><Button variant="secondary" onClick={() => { setAgora(Date.now()); recarregar(); }}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
          <Link href="/integracoes/bambu/?aba=config"><Button variant="secondary"><Plug className="h-4 w-4" /> Agentes</Button></Link></>} />
      <Tabs abas={[["painel", "Impressoras"], ["trabalhos", `Trabalhos${semOrdem ? ` (${semOrdem} sem ordem)` : ""}`], ["eventos", "Histórico de eventos"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && <>
        {!dados.ags.length && <div className="mb-4"><Aviso tom="amarelo">Nenhum agente local conectado. Instale o agente num computador da rede da loja e pareie em <Link className="underline" href="/integracoes/bambu/?aba=config">Integrações › Configurações</Link>. Sem agente, nenhum estado é mostrado (não presumimos que a impressora está livre).</Aviso></div>}
        {aba === "painel" && <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar…" value={filtro.busca} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} className="w-48" />
            <Select value={filtro.fab} onChange={(e) => setFiltro({ ...filtro, fab: e.target.value })} className="w-48" aria-label="Fabricante"><option value="">Todos os fabricantes</option>
              {fabricantes.map((f) => <option key={f} value={f}>{f}</option>)}{Object.entries(CONEXOES).map(([k, v]) => <option key={k} value={k}>Conexão: {v}</option>)}</Select>
            <Select value={filtro.situacao} onChange={(e) => setFiltro({ ...filtro, situacao: e.target.value })} className="w-48" aria-label="Situação"><option value="">Todas</option><option value="ativas">Imprimindo agora</option>
              <option value="online">Online</option><option value="offline">Offline / sem atualização</option>{["Disponível", "Erro", "Manutenção", "Desconhecido"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            <div className="ml-auto flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              <button onClick={() => setModo("cards")} aria-label="Cards" className={cn("rounded p-1.5", modo === "cards" && "bg-slate-100 dark:bg-slate-800")}><LayoutGrid className="h-4 w-4" /></button>
              <button onClick={() => setModo("lista")} aria-label="Lista" className={cn("rounded p-1.5", modo === "lista" && "bg-slate-100 dark:bg-slate-800")}><List className="h-4 w-4" /></button></div>
          </div>
          {!lista.length ? <Empty texto="Nenhuma impressora com esses filtros" /> : modo === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{lista.map((i) => <CardImp key={i.id} i={i} t={tel(i.id)} agora={agora} trab={dados.trabs.find((x) => x.impressora_id === i.id && ["imprimindo", "pausado"].includes(x.status))}
              fila={dados.ops.filter((o) => o.impressora_id === i.id && ["na_fila", "aguardando_material", "planejada"].includes(o.status))} onConectar={() => setConectar(i)} onDesligar={() => setDesligar(i)} />)}</div>
          ) : (
            <Card><Table head={["Impressora", "Conexão", "Estado", "Trabalho", "Progresso", "Restante", "Bico / mesa", "Atualizado"]}>{lista.map((i) => { const t = tel(i.id); const s = situacao(i, t, agora); return (
              <tr key={i.id}><Td><div className="font-medium">{i.nome}</div><div className="text-xs text-slate-500">{[i.fabricante, i.modelo].filter(Boolean).join(" ")}</div></Td>
                <Td><Badge tom={s.conTom}>{s.con}</Badge></Td><Td><Badge tom={s.opTom}>{s.op}</Badge></Td><Td className="max-w-48 truncate text-sm">{s.atual ? t?.arquivo || "—" : "—"}</Td>
                <Td className="tnum">{s.atual && t?.progresso != null ? `${num(t.progresso, 0)}%` : "—"}</Td><Td>{s.atual ? tempo(t?.restante_s ?? null) : "—"}</Td>
                <Td className="tnum text-sm">{s.atual && t ? `${t.temp_bico != null ? num(t.temp_bico, 0) : "—"} / ${t.temp_mesa != null ? num(t.temp_mesa, 0) : "—"} °C` : "—"}</Td>
                <Td className="text-xs text-slate-500">{t ? dataHora(t.recebido_em) : "—"}</Td></tr>); })}</Table></Card>
          )}
        </>}
        {aba === "trabalhos" && <Card>
          {!dados.trabs.length ? <Empty texto="Os trabalhos aparecem aqui quando o agente detecta uma impressão" /> : (
            <Table head={["Impressora", "Arquivo", "Início", "Situação", "Tempo efetivo", "Ordem de produção"]}>{dados.trabs.map((t) => (
              <tr key={t.id} className={cn(t.id === trabUrl && "bg-amber-50 dark:bg-amber-950/20")}><Td>{nomeImp(t.impressora_id)}</Td><Td className="max-w-52 truncate">{t.arquivo || t.chave}</Td>
                <Td className="text-sm">{dataHora(t.iniciado_em)}</Td>
                <Td><Badge tom={t.status === "concluido" ? "verde" : t.status === "falhou" ? "vermelho" : t.status === "cancelado" ? "cinza" : "azul"}>{({ imprimindo: "Imprimindo", pausado: "Pausado", concluido: "Concluído", falhou: "Falhou", cancelado: "Cancelado" } as Record<string, string>)[t.status]}</Badge>
                  {t.progresso != null && ["imprimindo", "pausado"].includes(t.status) && <span className="ml-1 text-xs">{num(t.progresso, 0)}%</span>}</Td>
                <Td className="text-sm">{t.duracao_s != null ? <>{tempo(t.duracao_s)}{t.ordens_producao?.tempo_previsto_h ? <div className="text-xs text-slate-500">previsto {tempo(t.ordens_producao.tempo_previsto_h * 3600)}</div> : null}</> : "—"}</Td>
                <Td>{t.ordem_id && t.ordens_producao ? <div className="flex items-center gap-2"><Link className="text-brand-600 hover:underline" href={`/producao/?id=${t.ordem_id}`}>OP-{t.ordens_producao.numero}</Link>
                  {app.pode("producao_gerenciar") && <button className="text-xs text-slate-400 hover:text-slate-700" onClick={() => setVincular(t)}>trocar</button>}</div>
                  : app.pode("producao_gerenciar") && app.podeEscrever ? <Button size="sm" variant={t.sugestao_ordem_id ? "primary" : "secondary"} onClick={() => setVincular(t)}><Link2 className="h-3.5 w-3.5" /> {t.sugestao_ordem_id ? "Confirmar sugestão" : "Vincular"}</Button> : <span className="text-sm text-slate-400">Sem ordem</span>}</Td></tr>))}</Table>)}
          <p className="mt-3 text-xs text-slate-500">A conclusão detectada não encerra a ordem nem baixa material: confirme a peça na ordem de produção (o tempo efetivo do trabalho aparece como referência).</p>
        </Card>}
        {aba === "eventos" && <Card>
          {!dados.evs.length ? <Empty texto="Nenhum evento ainda" /> : <Table head={["Quando", "Impressora", "Evento", "Detalhes"]}>{dados.evs.map((e) => (
            <tr key={e.id}><Td className="text-sm">{dataHora(e.ocorrido_em)}</Td><Td>{nomeImp(e.impressora_id)}</Td>
              <Td><Badge tom={["impressao_falhou", "erro", "erro_autenticacao", "temperatura_anormal"].includes(e.tipo) ? "vermelho" : e.tipo === "impressao_concluida" ? "verde" : e.tipo === "desconectada" ? "amarelo" : "cinza"}>{EVENTO[e.tipo] || e.tipo}</Badge></Td>
              <Td className="text-xs text-slate-500">{[e.dados.arquivo, e.dados.codigo && `código ${e.dados.codigo}`, e.dados.mensagem, e.dados.temp_bico && `bico ${e.dados.temp_bico} °C`].filter(Boolean).join(" · ")}</Td></tr>))}</Table>}
        </Card>}
      </>}
      {conectar && dados && <ConectarImpressora imp={conectar} agentes={dados.ags} onClose={() => setConectar(null)} onMudou={recarregar} tel={tel(conectar.id)} />}
      <Confirmar aberto={!!desligar} titulo="Desconectar do monitoramento" perigo confirmar="Desconectar" onCancel={() => setDesligar(null)}
        texto="A impressora deixa de ser monitorada. O histórico de eventos e trabalhos continua. Remova também a impressora da configuração do agente local."
        onOk={async () => { try { await rpc("desconectar_impressora", { p_impressora: desligar!.id }); toast("Impressora desconectada"); setDesligar(null); recarregar(); } catch (e) { erro(e); } }} />
      {vincular && dados && <VincularTrabalho t={vincular} ops={dados.ops} onClose={() => setVincular(null)} onMudou={recarregar} />}
    </>
  );
}

function CardImp({ i, t, agora, trab, fila, onConectar, onDesligar }: { i: Imp; t?: Tel; agora: number; trab?: Trab; fila: Op[]; onConectar: () => void; onDesligar: () => void }) {
  const app = useApp();
  const s = situacao(i, t, agora);
  const edita = app.podeEscrever && (app.pode("impressoras_editar") || app.pode("integracoes_config"));
  const libera = s.atual && t?.restante_s ? new Date(agora + t.restante_s * 1000) : null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-semibold">{i.nome}</div><div className="text-xs text-slate-500">{[i.fabricante, i.modelo].filter(Boolean).join(" ") || "—"}{i.conexao_tipo !== "nenhuma" ? ` · ${CONEXOES[i.conexao_tipo]}` : ""}</div></div>
        <div className="flex flex-col items-end gap-1"><Badge tom={s.conTom}>{s.con === "Online" ? <Wifi className="mr-1 h-3 w-3" /> : s.con === "Erro de autenticação" ? <KeyRound className="mr-1 h-3 w-3" /> : s.con === "Não conectada" ? null : <WifiOff className="mr-1 h-3 w-3" />}{s.con}</Badge>
          <Badge tom={s.opTom}>{s.op}</Badge></div>
      </div>
      {i.conexao_tipo === "nenhuma" ? (
        <div className="text-sm text-slate-500">Esta impressora não está ligada ao monitoramento.{edita && <Button size="sm" className="mt-2 w-full" variant="secondary" onClick={onConectar}><Plug className="h-4 w-4" /> Conectar</Button>}</div>
      ) : <>
        {s.atual && t && ["imprimindo", "pausada", "preparando", "finalizando"].includes(t.estado) && <div>
          <div className="mb-1 flex justify-between text-sm"><span className="truncate" title={t.arquivo || ""}>{t.arquivo || "Trabalho atual"}</span><span className="tnum font-medium">{t.progresso != null ? `${num(t.progresso, 0)}%` : ""}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={cn("h-full", t.estado === "pausada" ? "bg-amber-500" : "bg-brand-600")} style={{ width: `${t.progresso ?? 0}%` }} /></div>
          <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Decorrido {tempo(t.decorrido_s)}</span><span>Restante {tempo(t.restante_s)}{libera ? ` · livre ~${libera.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span></div>
          {t.camada != null && t.total_camadas ? <div className="text-xs text-slate-500">Camada {t.camada}/{t.total_camadas}</div> : null}
        </div>}
        {s.atual && t && <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><Thermometer className="h-4 w-4 text-slate-400" />
          <span>Bico {t.temp_bico != null ? `${num(t.temp_bico, 0)}°` : "—"}{t.temp_bico_alvo ? `/${num(t.temp_bico_alvo, 0)}°` : ""}</span>
          <span>Mesa {t.temp_mesa != null ? `${num(t.temp_mesa, 0)}°` : "—"}{t.temp_mesa_alvo ? `/${num(t.temp_mesa_alvo, 0)}°` : ""}</span>
          {t.temp_camara != null && <span>Câmara {num(t.temp_camara, 0)}°</span>}</div>}
        {s.atual && t?.extras?.ams?.length ? <div className="flex flex-wrap gap-1">{t.extras.ams.map((a, k) => <span key={k} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
          <span className="h-3 w-3 rounded-full border" style={{ background: `#${a.cor.slice(0, 6)}` }} />{a.tipo}</span>)}</div> : null}
        {s.atual && t?.erro_codigo && <Aviso tom="vermelho">Código de erro {t.erro_codigo}</Aviso>}
        {!s.atual && t && <p className="text-xs text-slate-500">Última leitura: {dataHora(t.recebido_em)}. Dados antigos não são mostrados como estado atual.</p>}
        {!t && <p className="flex items-center gap-1 text-xs text-slate-500"><HelpCircle className="h-3.5 w-3.5" /> Aguardando o agente enviar dados ({i.dispositivo_id}).</p>}
        {trab && <div className="text-sm">{trab.ordens_producao ? <>Ordem: <Link className="text-brand-600 hover:underline" href={`/producao/?id=${trab.ordem_id}`}>OP-{trab.ordens_producao.numero}</Link></> : <Link className="text-amber-700 underline" href={`/impressoras/monitoramento/?trabalho=${trab.id}`}>Impressão sem ordem vinculada</Link>}</div>}
        {fila.length > 0 && <div className="text-xs text-slate-500"><Clock className="mr-1 inline h-3.5 w-3.5" />{fila.length} ordem(ns) aguardando esta impressora</div>}
        <div className="mt-auto flex justify-between pt-1 text-xs text-slate-400"><span>{t ? `Atualizado ${dataHora(t.recebido_em)}` : ""}</span>
          {edita && <span className="flex gap-2"><button className="hover:text-slate-700" onClick={onConectar}>Configurar</button><button className="hover:text-red-600" onClick={onDesligar}><Unplug className="inline h-3.5 w-3.5" /></button></span>}</div>
      </>}
    </Card>
  );
}

function ConectarImpressora({ imp, agentes, tel, onClose, onMudou }: { imp: Imp; agentes: Agente[]; tel?: Tel; onClose: () => void; onMudou: () => void }) {
  const [f, setF] = useState({ tipo: imp.conexao_tipo !== "nenhuma" ? imp.conexao_tipo : "bambu_lan", agente: imp.agente_id || agentes[0]?.id || "", id: imp.dispositivo_id || "" });
  const [salvo, setSalvo] = useState<number | null>(null);
  const detectados = agentes.flatMap((a) => a.dispositivos_detectados.map((d) => ({ ...d, agente: a.id, agenteNome: a.nome }))).filter((d) => d.tipo_conexao === f.tipo);
  const confirmado = salvo != null && tel && new Date(tel.recebido_em).getTime() > salvo;
  const salvar = async () => {
    try {
      await q(sb().from("impressoras").update({ conexao_tipo: f.tipo, dispositivo_id: f.id.trim(), agente_id: f.agente || null }).eq("id", imp.id));
      setSalvo(Date.now()); toast("Ligação salva. Aguardando dados do agente…"); onMudou();
    } catch (e) { erro(e); }
  };
  useEffect(() => { if (salvo == null || confirmado) return; const t = setInterval(onMudou, 5000); return () => clearInterval(t); }, [salvo, confirmado, onMudou]);
  // só caracteres seguros no comando que o usuário cola no terminal (o nome vem do cadastro e não é confiável)
  const nomeCmd = (imp.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ._-]/g, "").trim() || "impressora").slice(0, 60);
  const idCmd = f.id.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  const cmd = f.tipo === "bambu_lan" ? `python3 mrv3d_agente.py adicionar bambu --nome "${nomeCmd}" --ip IP_DA_IMPRESSORA --serial ${idCmd || "NUMERO_DE_SERIE"} --codigo CODIGO_DE_ACESSO_LAN`
    : f.tipo === "moonraker" ? `python3 mrv3d_agente.py adicionar moonraker --nome "${nomeCmd}" --ip IP_DA_IMPRESSORA${idCmd ? ` --id ${idCmd}` : ""}`
    : `python3 mrv3d_agente.py adicionar octoprint --nome "${nomeCmd}" --ip IP_DO_OCTOPRINT --api-key SUA_CHAVE${idCmd ? ` --id ${idCmd}` : ""}`;
  return (
    <Modal aberto titulo={`Conectar ${imp.nome}`} onClose={onClose} largura="max-w-2xl">
      <div className="space-y-4 text-sm">
        <Field label="1. Fabricante / método de conexão"><Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          {Object.entries(CONEXOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        {f.tipo === "bambu_lan" && <Aviso>Bambu Lab: leitura pela rede local (MQTT) com o código de acesso LAN. Em firmwares recentes pode ser preciso ativar o modo LAN Only (e, em alguns modelos, o Modo Desenvolvedor), conforme a Bambu Lab. A nuvem Bambu e o controle remoto não são usados. Não pedimos a senha da conta.</Aviso>}
        <p className="text-xs text-slate-500">Outras marcas (Prusa Connect, Creality Cloud, Elegoo…): integração não disponível ainda — não anunciamos compatibilidade sem testar.</p>
        <Field label="2. Agente local">{agentes.length ? <Select value={f.agente} onChange={(e) => setF({ ...f, agente: e.target.value })}>{agentes.map((a) => <option key={a.id} value={a.id}>{a.nome}{a.ultimo_contato ? ` · visto ${dataHora(a.ultimo_contato)}` : " · nunca conectou"}</option>)}</Select>
          : <Aviso tom="amarelo">Nenhum agente pareado. <Link className="underline" href="/integracoes/bambu/?aba=config">Parear um agente</Link>.</Aviso>}</Field>
        <div><div className="mb-1 font-medium text-slate-600 dark:text-slate-300">3. No computador do agente, adicione a impressora (as credenciais ficam só lá)</div>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{cmd}</pre></div>
        {detectados.length > 0 && <div><div className="mb-1 font-medium text-slate-600 dark:text-slate-300">Encontradas pelo agente e ainda não ligadas</div>
          <div className="flex flex-wrap gap-2">{detectados.map((d) => <Button key={d.dispositivo_id} size="sm" variant={f.id === d.dispositivo_id ? "primary" : "secondary"} onClick={() => setF({ ...f, id: d.dispositivo_id, agente: d.agente })}>{d.nome || d.dispositivo_id} · {d.dispositivo_id}</Button>)}</div></div>}
        <Field label={f.tipo === "bambu_lan" ? "4. Número de série da impressora" : "4. Identificador (o mesmo mostrado pelo agente)"}><Input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.replace(/[^A-Za-z0-9._-]/g, "") })} placeholder={f.tipo === "bambu_lan" ? "01P00A123456789" : "voron-24"} /></Field>
        <div className="flex items-center justify-between gap-2">
          <div>{salvo != null && (confirmado ? <Badge tom="verde">Conexão confirmada: {tel?.conexao === "online" ? "online" : tel?.conexao}</Badge> : <span className="flex items-center gap-1 text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" /> 5. Testando: aguardando o agente enviar dados…</span>)}</div>
          <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button disabled={f.id.length < 3} onClick={salvar}>Salvar e testar</Button></div>
        </div>
      </div>
    </Modal>
  );
}

function VincularTrabalho({ t, ops, onClose, onMudou }: { t: Trab; ops: Op[]; onClose: () => void; onMudou: () => void }) {
  const [op, setOp] = useState(t.ordem_id || t.sugestao_ordem_id || "");
  const [ocupado, setOcupado] = useState(false);
  const daImp = ops.filter((o) => o.impressora_id === t.impressora_id), outras = ops.filter((o) => o.impressora_id !== t.impressora_id);
  return (
    <Modal aberto titulo="Vincular impressão a uma ordem de produção" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>Arquivo: <b>{t.arquivo || t.chave}</b> · início {dataHora(t.iniciado_em)}</p>
        {t.sugestao_ordem_id && <Aviso>Sugestão pelo nome do arquivo e pela fila da impressora. Confira antes de confirmar.</Aviso>}
        <Field label="Ordem de produção"><Select value={op} onChange={(e) => setOp(e.target.value)}><option value="">Sem ordem</option>
          {daImp.length > 0 && <optgroup label="Nesta impressora">{daImp.map((o) => <option key={o.id} value={o.id}>OP-{o.numero} · {o.descricao} ({o.status}){o.id === t.sugestao_ordem_id ? " — sugerida" : ""}</option>)}</optgroup>}
          {outras.length > 0 && <optgroup label="Outras">{outras.map((o) => <option key={o.id} value={o.id}>OP-{o.numero} · {o.descricao} ({o.status})</option>)}</optgroup>}</Select></Field>
        <p className="text-xs text-slate-500">Se a impressão está em andamento, a ordem passa para “imprimindo” com o horário real de início. A conclusão continua sendo confirmada na ordem.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={ocupado} onClick={async () => { setOcupado(true); try { const m = await rpc<string>("vincular_trabalho_ordem", { p_trabalho: t.id, p_ordem: op || null }); toast(m.startsWith("vinculado;") ? m : op ? "Impressão vinculada" : "Vínculo removido", m.startsWith("vinculado;") ? "erro" : "ok"); onMudou(); onClose(); } catch (e) { erro(e); } finally { setOcupado(false); } }}>Confirmar</Button></div>
      </div>
    </Modal>
  );
}
