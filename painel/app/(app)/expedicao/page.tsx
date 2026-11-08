"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Send, PackageCheck, Tag, Paperclip, MessageCircle, Download, Ban, Truck } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, enviarArquivo, urlTemporaria } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, numOuNull, linkWhats, STATUS_ENVIO, MODALIDADES_ENVIO, STATUS_PAGAMENTO, UFS, baixarCsv, csvNum, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Checkbox, Confirmar, Aviso, Tabs, Kpi } from "@/components/ui";

type PedidoResumo = { id: string; numero: number; descricao: string | null; valor_total: number; valor_pago: number; status_pagamento: string; status_producao: string; status_entrega: string;
  data_entrega: string | null; clientes: { nome: string; whatsapp: string | null; telefone: string | null } | null };
export type Envio = { id: string; numero: number; pedido_id: string; status: string; modalidade: string; destinatario: string | null; telefone: string | null; endereco: string | null; cidade: string | null;
  uf: string | null; cep: string | null; peso_g: number | null; altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null; volumes: number; frete_custo: number; frete_cobrado: number;
  transportadora: string | null; servico: string | null; codigo_rastreio: string | null; data_postagem: string | null; previsao_entrega: string | null; entregue_em: string | null; recebido_por: string | null;
  comprovante_path: string | null; conferido_em: string | null; observacoes: string | null; lancamento_id: string | null; created_at: string; pedidos: PedidoResumo | null };
type Aba = "prontos" | "andamento" | "concluidos";
const FECHADOS = ["entregue", "retirado", "cancelado", "devolvido"];

export default function Expedicao() { return <Exige perm={["expedicao_gerenciar", "pedidos_ver"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const edita = app.pode("expedicao_gerenciar") && app.podeEscrever;
  const [aba, setAba] = useState<Aba>("prontos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [criar, setCriar] = useState<{ p: PedidoResumo; modalidade: string } | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [peds, envios] = await Promise.all([
      q<PedidoResumo[]>(sb().from("pedidos").select("id,numero,descricao,valor_total,valor_pago,status_pagamento,status_producao,status_entrega,data_entrega,clientes(nome,whatsapp,telefone)")
        .eq("empresa_id", app.empresa.id).neq("status", "cancelado").in("status_entrega", ["pendente", "pronto"]).order("data_entrega", { nullsFirst: false }).limit(2000)),
      q<Envio[]>(sb().from("envios").select("*,pedidos(id,numero,descricao,valor_total,valor_pago,status_pagamento,status_producao,status_entrega,data_entrega,clientes(nome,whatsapp,telefone))")
        .eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(2000)),
    ]);
    const comEnvio = new Set(envios.filter((e) => !["cancelado", "devolvido"].includes(e.status)).map((e) => e.pedido_id));
    const prontos = peds.filter((p) => !comEnvio.has(p.id) && (p.status_entrega === "pronto" || ["concluida", "nao_aplica"].includes(p.status_producao)));
    return { prontos, envios };
  }, [app.empresa.id]);
  const andamento = useMemo(() => (dados?.envios || []).filter((e) => !FECHADOS.includes(e.status)), [dados]);
  const concluidos = useMemo(() => (dados?.envios || []).filter((e) => FECHADOS.includes(e.status)), [dados]);
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader titulo="Expedição e Entregas" sub="Pedido pronto → separação → conferência → embalagem → envio ou retirada → entrega" />
      <Tabs abas={[["prontos", `Prontos para expedir${dados?.prontos.length ? ` (${dados.prontos.length})` : ""}`], ["andamento", `Em andamento${andamento.length ? ` (${andamento.length})` : ""}`], ["concluidos", "Concluídos"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && <>
        {aba === "prontos" && <Card>
          {!dados.prontos.length ? <Empty texto="Nenhum pedido pronto. Pedidos aparecem aqui quando a produção termina." /> : (
            <Table head={["Pedido", "Cliente", "Prazo", "Pagamento", ""]}>{dados.prontos.map((p) => (
              <tr key={p.id}><Td><Link href={`/pedidos/?id=${p.id}`} className="font-medium text-brand-600 hover:underline">#{p.numero}</Link> {p.descricao}</Td>
                <Td>{p.clientes?.nome || "—"}</Td><Td className={cn(p.data_entrega && p.data_entrega < hoje && "font-medium text-red-600")}>{data(p.data_entrega)}</Td>
                <Td><Badge tom={tomStatus(p.status_pagamento)}>{STATUS_PAGAMENTO[p.status_pagamento]}</Badge></Td>
                <Td>{edita && <Button size="sm" onClick={() => setCriar({ p, modalidade: "correios" })}><Send className="h-4 w-4" /> Expedir</Button>}</Td></tr>))}</Table>)}
        </Card>}
        {aba === "andamento" && <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">{["separacao", "conferencia", "embalado", "aguardando_coleta", "enviado"].map((s) =>
            <Kpi key={s} label={STATUS_ENVIO[s]} valor={andamento.filter((e) => e.status === s || (s === "enviado" && e.status === "em_transito")).length} />)}</div>
          <Card>{!andamento.length ? <Empty texto="Nenhum envio em andamento" /> : <ListaEnvios lista={andamento} onAbrir={setAberto} />}</Card>
        </>}
        {aba === "concluidos" && <Card>
          <CardTitle right={<Button size="sm" variant="secondary" onClick={() => baixarCsv("envios", [["Envio", "Pedido", "Cliente", "Modalidade", "Situação", "Rastreio", "Postagem", "Entregue", "Frete (custo)", "Frete (cobrado)"],
            ...concluidos.map((e) => [e.numero, e.pedidos?.numero, e.pedidos?.clientes?.nome, MODALIDADES_ENVIO[e.modalidade], STATUS_ENVIO[e.status], e.codigo_rastreio, e.data_postagem, e.entregue_em?.slice(0, 10), csvNum(e.frete_custo), csvNum(e.frete_cobrado)])])}>
            <Download className="h-4 w-4" /> CSV</Button>}>Envios concluídos</CardTitle>
          {!concluidos.length ? <Empty texto="Nada por aqui ainda" /> : <ListaEnvios lista={concluidos} onAbrir={setAberto} />}
        </Card>}
      </>}

      <Modal aberto={!!criar} titulo={`Expedir pedido #${criar?.p.numero}`} onClose={() => setCriar(null)}>
        {criar && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { const id = await rpc<string>("criar_envio", { p_pedido: criar.p.id, p_modalidade: criar.modalidade }); setCriar(null); recarregar(); setAba("andamento"); setAberto(id); } catch (e2) { erro(e2); } }}>
          <Field label="Como vai chegar ao cliente?"><Select value={criar.modalidade} onChange={(e) => setCriar({ ...criar, modalidade: e.target.value })}>{Object.entries(MODALIDADES_ENVIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          {criar.modalidade === "melhor_envio" && <Aviso tom="amarelo">A integração com o Melhor Envio ainda não está ligada: gere a etiqueta no site deles e cole o rastreio aqui.</Aviso>}
          {criar.p.status_pagamento !== "pago" && <Aviso tom="amarelo">Atenção: pedido com pagamento {STATUS_PAGAMENTO[criar.p.status_pagamento].toLowerCase()} ({brl(criar.p.valor_total - criar.p.valor_pago)} em aberto).</Aviso>}
          <p className="text-sm text-slate-500">O endereço vem do cadastro do cliente e pode ser ajustado no envio.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCriar(null)}>Cancelar</Button><Button type="submit"><Send className="h-4 w-4" /> Iniciar separação</Button></div>
        </form>}
      </Modal>
      {aberto && <DetalheEnvio id={aberto} edita={edita} onClose={() => setAberto(null)} onMudou={recarregar} />}
    </>
  );
}

function ListaEnvios({ lista, onAbrir }: { lista: Envio[]; onAbrir: (id: string) => void }) {
  return (
    <Table head={["Envio", "Pedido / cliente", "Modalidade", "Situação", "Rastreio", "Previsão"]}>{lista.map((e) => (
      <tr key={e.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => onAbrir(e.id)}>
        <Td className="font-medium">#{e.numero}</Td><Td><div>Pedido #{e.pedidos?.numero} {e.pedidos?.descricao}</div><div className="text-xs text-slate-500">{e.destinatario || e.pedidos?.clientes?.nome}{e.cidade ? ` · ${e.cidade}/${e.uf || ""}` : ""}</div></Td>
        <Td>{MODALIDADES_ENVIO[e.modalidade]}</Td><Td><Badge tom={tomStatus(e.status)}>{STATUS_ENVIO[e.status]}</Badge></Td><Td className="font-mono text-xs">{e.codigo_rastreio || "—"}</Td>
        <Td>{e.entregue_em ? `Entregue ${data(e.entregue_em)}` : data(e.previsao_entrega)}</Td></tr>))}</Table>
  );
}

function DetalheEnvio({ id, edita, onClose, onMudou }: { id: string; edita: boolean; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Envio | null>(null);
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [passo, setPasso] = useState<{ status: string; obs: string; recebido: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { dados, erro: falha, recarregar } = useDados(async () => {
    const [[e], itens, eventos] = await Promise.all([
      q<Envio[]>(sb().from("envios").select("*,pedidos(id,numero,descricao,valor_total,valor_pago,status_pagamento,status_producao,status_entrega,data_entrega,clientes(nome,whatsapp,telefone))").eq("id", id)),
      q<{ id: string; descricao: string; quantidade: number }[]>(sb().from("pedido_itens").select("id,descricao,quantidade").eq("pedido_id", (await q<{ pedido_id: string }[]>(sb().from("envios").select("pedido_id").eq("id", id)))[0]?.pedido_id || "")),
      q<{ id: number; status_novo: string; observacao: string | null; created_at: string }[]>(sb().from("envio_eventos").select("id,status_novo,observacao,created_at").eq("envio_id", id).order("id")),
    ]);
    if (!e) throw new Error("Envio não encontrado");
    setF(e);
    return { e, itens, eventos };
  }, [id]);
  const e = dados?.e;
  const fechado = !!e && FECHADOS.includes(e.status);
  const mudou = () => { recarregar(); onMudou(); };
  const salvar = async () => {
    if (!f) return; setOcupado(true);
    try {
      await q(sb().from("envios").update(fechado ? { observacoes: f.observacoes || null, recebido_por: f.recebido_por || null } : {
        modalidade: f.modalidade, destinatario: f.destinatario || null, telefone: f.telefone || null, endereco: f.endereco || null, cidade: f.cidade || null, uf: f.uf || null, cep: f.cep || null,
        peso_g: f.peso_g, altura_cm: f.altura_cm, largura_cm: f.largura_cm, comprimento_cm: f.comprimento_cm, volumes: f.volumes || 1, frete_custo: f.frete_custo || 0, frete_cobrado: f.frete_cobrado || 0,
        transportadora: f.transportadora || null, servico: f.servico || null, codigo_rastreio: f.codigo_rastreio?.trim() || null, previsao_entrega: f.previsao_entrega || null, recebido_por: f.recebido_por || null,
        observacoes: f.observacoes || null }).eq("id", id));
      toast("Envio salvo"); mudou(); return true;
    } catch (e2) { erro(e2); return false; } finally { setOcupado(false); }
  };
  const mudar = async (status: string, obs?: string, recebido?: string) => {
    setOcupado(true);
    try { await rpc("mudar_status_envio", { p_envio: id, p_status: status, p_obs: obs || null, p_recebido_por: recebido || null }); toast(STATUS_ENVIO[status]); setPasso(null); mudou(); }
    catch (e2) { erro(e2); } finally { setOcupado(false); }
  };
  // salva o que foi digitado e avança
  const avancar = async (status: string) => {
    if (!(await salvar())) return;
    if (["retirado", "cancelado", "devolvido"].includes(status) || (status === "entregue" && f?.modalidade === "entrega_propria")) setPasso({ status, obs: "", recebido: f?.recebido_por || "" });
    else mudar(status);
  };
  const proximos = (): string[] => {
    if (!e) return [];
    const envia = !["retirada", "entrega_propria"].includes(e.modalidade);
    switch (e.status) {
      case "conferencia": return ["embalado"];
      case "embalado": return e.modalidade === "retirada" ? ["retirado"] : e.modalidade === "entrega_propria" ? ["entregue"] : ["aguardando_coleta", "enviado"];
      case "aguardando_coleta": return envia ? ["enviado"] : ["entregue"];
      case "enviado": return ["em_transito", "entregue"];
      case "em_transito": return ["entregue"];
      default: return [];
    }
  };
  const num2 = (k: keyof Envio) => ({ value: f?.[k] == null ? "" : String(f[k]).replace(".", ","), onChange: (ev: React.ChangeEvent<HTMLInputElement>) => f && setF({ ...f, [k]: numOuNull(ev.target.value) }) });
  const todosOk = !!dados && dados.itens.length > 0 && dados.itens.every((i) => ok[i.id]);
  const tel = e?.telefone || e?.pedidos?.clientes?.whatsapp || e?.pedidos?.clientes?.telefone;

  return (
    <Modal aberto titulo={e ? `Envio #${e.numero} · pedido #${e.pedidos?.numero}` : "Envio"} onClose={onClose} largura="max-w-4xl">
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : !dados || !e || !f ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={tomStatus(e.status)}>{STATUS_ENVIO[e.status]}</Badge><span className="text-sm text-slate-500">{MODALIDADES_ENVIO[e.modalidade]}</span>
            {e.conferido_em && <span className="text-xs text-emerald-700">✓ conferido {dataHora(e.conferido_em)}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Link href={`/expedicao/etiqueta/?id=${e.id}`} target="_blank"><Button size="sm" variant="secondary"><Tag className="h-4 w-4" /> Etiqueta</Button></Link>
              {tel && e.codigo_rastreio && <a target="_blank" rel="noreferrer" href={linkWhats(tel, `Olá! Seu pedido #${e.pedidos?.numero} da ${app.empresa.nome} foi enviado${e.transportadora ? ` por ${e.transportadora}` : ""}. Código de rastreio: ${e.codigo_rastreio}`) || "#"}>
                <Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4" /> Avisar cliente</Button></a>}
              {edita && proximos().map((s) => <Button key={s} size="sm" loading={ocupado} onClick={() => avancar(s)}><Truck className="h-4 w-4" /> {STATUS_ENVIO[s]}</Button>)}
              {edita && ["separacao", "conferencia", "embalado", "aguardando_coleta"].includes(e.status) && <Button size="sm" variant="ghost" onClick={() => setPasso({ status: "cancelado", obs: "", recebido: "" })}><Ban className="h-4 w-4" /> Cancelar</Button>}
              {edita && ["enviado", "em_transito", "entregue"].includes(e.status) && <Button size="sm" variant="ghost" onClick={() => setPasso({ status: "devolvido", obs: "", recebido: "" })}>Devolvido</Button>}
            </div>
          </div>
          {e.pedidos && e.pedidos.status_pagamento !== "pago" && <Aviso tom="amarelo">Pagamento {STATUS_PAGAMENTO[e.pedidos.status_pagamento].toLowerCase()}: faltam {brl(e.pedidos.valor_total - e.pedidos.valor_pago)}.</Aviso>}

          {["separacao", "conferencia"].includes(e.status) && <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Separação e conferência</h3>
            {!dados.itens.length ? <p className="text-sm text-slate-500">O pedido não tem itens cadastrados: confira pela descrição “{e.pedidos?.descricao}”.</p> :
              <div className="space-y-1.5">{dados.itens.map((i) => <Checkbox key={i.id} label={`${num(i.quantidade)} × ${i.descricao}`} checked={!!ok[i.id]} onChange={(v) => setOk({ ...ok, [i.id]: v })} />)}</div>}
            {edita && <Button size="sm" className="mt-3" disabled={dados.itens.length > 0 && !todosOk} loading={ocupado}
              onClick={async () => { setOcupado(true); try { await rpc("conferir_envio", { p_envio: id }); toast("Itens conferidos"); mudou(); } catch (e2) { erro(e2); } finally { setOcupado(false); } }}>
              <PackageCheck className="h-4 w-4" /> Itens conferidos</Button>}
          </Card>}

          <fieldset disabled={!edita} className="space-y-4">
            <div><h3 className="mb-2 text-sm font-semibold">Destinatário</h3>
              <Grid cols={3}>
                <Field label="Nome"><Input disabled={fechado} value={f.destinatario || ""} onChange={(ev) => setF({ ...f, destinatario: ev.target.value })} /></Field>
                <Field label="Telefone"><Input disabled={fechado} value={f.telefone || ""} onChange={(ev) => setF({ ...f, telefone: ev.target.value })} /></Field>
                <Field label="CEP"><Input disabled={fechado} value={f.cep || ""} onChange={(ev) => setF({ ...f, cep: ev.target.value })} /></Field>
                <Field label="Endereço"><Input disabled={fechado} value={f.endereco || ""} onChange={(ev) => setF({ ...f, endereco: ev.target.value })} /></Field>
                <Field label="Cidade"><Input disabled={fechado} value={f.cidade || ""} onChange={(ev) => setF({ ...f, cidade: ev.target.value })} /></Field>
                <Field label="UF"><Select disabled={fechado} value={f.uf || ""} onChange={(ev) => setF({ ...f, uf: ev.target.value || null })}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
              </Grid></div>
            <div><h3 className="mb-2 text-sm font-semibold">Embalagem e frete</h3>
              <Grid cols={4}>
                <Field label="Modalidade"><Select disabled={fechado || !["separacao", "conferencia", "embalado"].includes(e.status)} value={f.modalidade} onChange={(ev) => setF({ ...f, modalidade: ev.target.value })}>{Object.entries(MODALIDADES_ENVIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Peso (g)"><Input disabled={fechado} inputMode="decimal" {...num2("peso_g")} /></Field>
                <Field label="Volumes"><Input disabled={fechado} inputMode="numeric" {...num2("volumes")} /></Field>
                <Field label="Dimensões A × L × C (cm)"><div className="flex gap-1"><Input disabled={fechado} inputMode="decimal" {...num2("altura_cm")} aria-label="Altura" /><Input disabled={fechado} inputMode="decimal" {...num2("largura_cm")} aria-label="Largura" /><Input disabled={fechado} inputMode="decimal" {...num2("comprimento_cm")} aria-label="Comprimento" /></div></Field>
                <Field label="Frete pago pela loja (R$)" hint="Vira conta a pagar quando sair"><Input disabled={fechado || !!e.lancamento_id} inputMode="decimal" {...num2("frete_custo")} /></Field>
                <Field label="Frete cobrado do cliente (R$)"><Input disabled={fechado} inputMode="decimal" {...num2("frete_cobrado")} /></Field>
                {!["retirada", "entrega_propria"].includes(f.modalidade) && <>
                  <Field label="Transportadora"><Input disabled={fechado} list="transp-exp" value={f.transportadora || ""} onChange={(ev) => setF({ ...f, transportadora: ev.target.value })} /></Field>
                  <Field label="Serviço"><Input disabled={fechado} placeholder="PAC, SEDEX…" value={f.servico || ""} onChange={(ev) => setF({ ...f, servico: ev.target.value })} /></Field>
                  <Field label="Código de rastreio"><Input disabled={fechado} className="font-mono" value={f.codigo_rastreio || ""} onChange={(ev) => setF({ ...f, codigo_rastreio: ev.target.value })} /></Field></>}
                <Field label="Previsão de entrega"><Input disabled={fechado} type="date" value={f.previsao_entrega || ""} onChange={(ev) => setF({ ...f, previsao_entrega: ev.target.value })} /></Field>
                {(f.modalidade === "retirada" || f.modalidade === "entrega_propria" || e.recebido_por) && <Field label="Recebido / retirado por"><Input value={f.recebido_por || ""} onChange={(ev) => setF({ ...f, recebido_por: ev.target.value })} /></Field>}
              </Grid>
              <datalist id="transp-exp">{["Correios", "Jadlog", "Loggi", "J&T Express", "Total Express", "Azul Cargo"].map((t) => <option key={t} value={t} />)}</datalist></div>
            <Field label="Observações"><Textarea value={f.observacoes || ""} onChange={(ev) => setF({ ...f, observacoes: ev.target.value })} /></Field>
            {edita && <div className="flex justify-end"><Button variant="secondary" loading={ocupado} onClick={salvar}>Salvar</Button></div>}
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-semibold">Comprovante de entrega / postagem</h3>
              {e.comprovante_path ? <button className="text-sm text-brand-600 underline" onClick={async () => { try { window.open(await urlTemporaria(e.comprovante_path!), "_blank"); } catch (e2) { erro(e2); } }}>Abrir comprovante</button>
                : <p className="text-sm text-slate-500">Nenhum anexado.</p>}
              {edita && <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-brand-600"><Paperclip className="h-4 w-4" /> {e.comprovante_path ? "Trocar" : "Anexar"} foto ou PDF
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={async (ev) => { const a = ev.target.files?.[0]; if (!a) return; try { const path = await enviarArquivo(app.empresa.id, "expedicao", a); await q(sb().from("envios").update({ comprovante_path: path }).eq("id", id)); toast("Comprovante anexado"); mudou(); } catch (e2) { erro(e2); } }} /></label>}
            </div>
            <div><h3 className="mb-2 text-sm font-semibold">Histórico</h3>
              <ol className="space-y-1 text-sm">{dados.eventos.map((ev) => <li key={ev.id} className="flex gap-2"><span className="w-32 shrink-0 text-slate-500">{dataHora(ev.created_at)}</span><span>{STATUS_ENVIO[ev.status_novo]}{ev.observacao ? ` · ${ev.observacao}` : ""}</span></li>)}</ol>
              {e.lancamento_id && <p className="mt-2 text-xs text-slate-500">Frete de {brl(e.frete_custo)} lançado em Contas a pagar.</p>}
            </div>
          </div>

          <Confirmar aberto={!!passo} titulo={passo ? STATUS_ENVIO[passo.status] : ""} perigo={passo?.status === "cancelado"} carregando={ocupado} onCancel={() => setPasso(null)}
            onOk={() => passo && mudar(passo.status, passo.obs, passo.recebido)}>
            {passo && <div className="mt-2 space-y-3">
              {["retirado", "entregue"].includes(passo.status) && <Field label={passo.status === "retirado" ? "Quem retirou" : "Quem recebeu"}><Input autoFocus value={passo.recebido} onChange={(ev) => setPasso({ ...passo, recebido: ev.target.value })} /></Field>}
              {["cancelado", "devolvido"].includes(passo.status) && <Field label="Motivo"><Input autoFocus value={passo.obs} onChange={(ev) => setPasso({ ...passo, obs: ev.target.value })} /></Field>}
              {passo.status === "devolvido" && <p className="text-sm text-slate-500">O pedido volta para “Prontos para expedir” e pode ser enviado de novo.</p>}
            </div>}
          </Confirmar>
        </div>
      )}
    </Modal>
  );
}
