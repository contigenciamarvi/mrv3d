"use client";
import { useMemo, useState } from "react";
import { Plus, Play, Check, Ban, Paperclip, Trash2, Download, AlertTriangle, CalendarClock } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, enviarArquivo, urlTemporaria } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, hojeISO, numOuNull, SERVICOS_MANUTENCAO, STATUS_MANUTENCAO, baixarCsv, csvNum, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Checkbox, Confirmar, Aviso, Tabs, Kpi } from "@/components/ui";

type Imp = { id: string; nome: string; status: string; horas_acumuladas: number };
type Plano = { id: string; impressora_id: string; servico: string; descricao: string | null; intervalo_horas: number | null; intervalo_dias: number | null; ultima_data: string | null; ultima_horas: number | null; ativo: boolean };
type Man = { id: string; impressora_id: string; plano_id: string | null; tipo: string; servico: string; descricao: string; status: string; agendada_para: string | null; iniciada_em: string | null;
  concluida_em: string | null; custo_pecas: number; custo_mao_obra: number; custo_total: number; tempo_parado_h: number | null; material_id: string | null; material_qtd: number | null;
  responsavel: string | null; observacoes: string | null; lancamento_id: string | null; created_at: string };
type Alerta = { plano_id: string; impressora_id: string; impressora: string; servico: string; descricao: string | null; faltam_horas: number | null; vence_em: string | null; nivel: string; agendada: boolean };
type Mat = { id: string; nome: string; cor: string | null; unidade: string; quantidade: number; quantidade_reservada: number; custo_medio: number };
type Aba = "agenda" | "historico" | "planos";

export default function Manutencao() { return <Exige perm="impressoras_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const edita = app.pode("impressoras_editar") && app.podeEscrever;
  const lanca = app.podeEscrever && (app.pode("financeiro_ver") || ["dono", "admin"].includes(app.papel));
  const [aba, setAba] = useState<Aba>("agenda");
  const [nova, setNova] = useState<Partial<Man> | null>(null);
  const [concluir, setConcluir] = useState<{ m: Man; pecas: string; mo: string; parado: string; material: string; qtd: string; obs: string; lancar: boolean } | null>(null);
  const [cancelar, setCancelar] = useState<{ m: Man; motivo: string } | null>(null);
  const [anexos, setAnexos] = useState<Man | null>(null);
  const [plano, setPlano] = useState<Partial<Plano> | null>(null);
  const [filtroImp, setFiltroImp] = useState("");
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [imps, planos, mans, alertas, mats] = await Promise.all([
      q<Imp[]>(sb().from("impressoras").select("id,nome,status,horas_acumuladas").eq("empresa_id", app.empresa.id).order("nome")),
      q<Plano[]>(sb().from("manutencao_planos").select("*").eq("empresa_id", app.empresa.id).order("created_at")),
      q<Man[]>(sb().from("manutencoes").select("*").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(2000)),
      rpc<Alerta[]>("manutencao_alertas", { p_empresa: app.empresa.id }),
      app.pode("materia_ver") ? q<Mat[]>(sb().from("materiais").select("id,nome,cor,unidade,quantidade,quantidade_reservada,custo_medio").eq("empresa_id", app.empresa.id).eq("ativo", true)
        .in("categoria", ["peca_reposicao", "componente", "consumivel", "outro"]).order("nome")) : Promise.resolve([] as Mat[]),
    ]);
    return { imps, planos, mans, alertas, mats };
  }, [app.empresa.id]);
  const nomeImp = (id: string) => dados?.imps.find((i) => i.id === id)?.nome || "—";
  const abertas = useMemo(() => (dados?.mans || []).filter((m) => ["agendada", "em_andamento"].includes(m.status)), [dados]);
  const historico = useMemo(() => (dados?.mans || []).filter((m) => !filtroImp || m.impressora_id === filtroImp), [dados, filtroImp]);
  const ano = hojeISO().slice(0, 4);
  const doAno = (dados?.mans || []).filter((m) => m.status === "concluida" && (m.concluida_em || "").startsWith(ano));

  const acao = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); recarregar(); return true; } catch (e) { erro(e); return false; } };
  const agendarDoPlano = (a: Alerta) => {
    const p = dados?.planos.find((x) => x.id === a.plano_id);
    setNova({ impressora_id: a.impressora_id, plano_id: a.plano_id, tipo: "preventiva", servico: a.servico, descricao: p?.descricao || SERVICOS_MANUTENCAO[a.servico], agendada_para: hojeISO() });
  };

  return (
    <>
      <PageHeader titulo="Manutenção das impressoras" sub="Preventiva e corretiva, avisos por horas de uso ou por data, custos e tempo de máquina parada"
        acoes={edita ? <Button onClick={() => setNova({ tipo: "corretiva", servico: "outro", descricao: "", impressora_id: dados?.imps[0]?.id, agendada_para: hojeISO() })}><Plus className="h-4 w-4" /> Registrar manutenção</Button> : undefined} />
      <Tabs abas={[["agenda", `Avisos e agenda${(dados?.alertas.filter((a) => a.nivel === "vencida").length || 0) + abertas.length ? ` (${(dados?.alertas.filter((a) => a.nivel === "vencida" && !a.agendada).length || 0) + abertas.length})` : ""}`], ["historico", "Histórico"], ["planos", "Planos preventivos"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && <>
        {aba === "agenda" && <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Em manutenção agora" valor={dados.imps.filter((i) => i.status === "manutencao").length} />
            <Kpi label="Avisos vencidos" valor={dados.alertas.filter((a) => a.nivel === "vencida").length} tom={dados.alertas.some((a) => a.nivel === "vencida") ? "vermelho" : undefined} />
            <Kpi label={`Custo em ${ano}`} valor={brl(doAno.reduce((s, m) => s + m.custo_total, 0))} />
            <Kpi label={`Máquina parada em ${ano}`} valor={`${num(doAno.reduce((s, m) => s + (m.tempo_parado_h || 0), 0), 1)} h`} />
          </div>
          <Card><CardTitle>Avisos dos planos preventivos</CardTitle>
            {!dados.alertas.length ? <Empty texto={dados.planos.length ? "Nada vencendo. Tudo em dia!" : "Crie planos preventivos (ex.: lubrificar a cada 200 h) para receber avisos"} /> : (
              <Table head={["Impressora", "Serviço", "Quando", "", ""]}>{dados.alertas.map((a) => (
                <tr key={a.plano_id}><Td className="font-medium">{a.impressora}</Td><Td>{SERVICOS_MANUTENCAO[a.servico]}{a.descricao ? ` · ${a.descricao}` : ""}</Td>
                  <Td className={cn(a.nivel === "vencida" && "font-medium text-red-600")}>
                    {a.faltam_horas != null && (a.faltam_horas <= 0 ? `Passou ${num(-a.faltam_horas, 1)} h` : `Faltam ${num(a.faltam_horas, 1)} h`)}
                    {a.faltam_horas != null && a.vence_em && " · "}{a.vence_em && `${a.vence_em < hojeISO() ? "Venceu" : "Vence"} ${data(a.vence_em)}`}</Td>
                  <Td>{a.nivel === "vencida" ? <Badge tom="vermelho">Vencida</Badge> : <Badge tom="amarelo">Próxima</Badge>}</Td>
                  <Td>{a.agendada ? <Badge tom="azul">Agendada</Badge> : edita && <Button size="sm" variant="secondary" onClick={() => agendarDoPlano(a)}><CalendarClock className="h-4 w-4" /> Agendar</Button>}</Td></tr>))}</Table>)}
          </Card>
          <Card><CardTitle>Agendadas e em andamento</CardTitle>
            {!abertas.length ? <Empty texto="Nenhuma manutenção aberta" /> : <ListaMan lista={abertas} nomeImp={nomeImp} edita={edita}
              onIniciar={(m) => acao(() => rpc("iniciar_manutencao", { p_id: m.id }), "Impressora em manutenção")}
              onConcluir={(m) => setConcluir({ m, pecas: m.custo_pecas ? String(m.custo_pecas).replace(".", ",") : "", mo: m.custo_mao_obra ? String(m.custo_mao_obra).replace(".", ",") : "", parado: "", material: m.material_id || "", qtd: m.material_qtd ? String(m.material_qtd).replace(".", ",") : "", obs: "", lancar: lanca })}
              onCancelar={(m) => setCancelar({ m, motivo: "" })} onAnexos={setAnexos} />}
          </Card>
        </div>}

        {aba === "historico" && <Card>
          <CardTitle right={<div className="flex gap-2"><Select value={filtroImp} onChange={(e) => setFiltroImp(e.target.value)} className="w-52" aria-label="Impressora"><option value="">Todas as impressoras</option>{dados.imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select>
            <Button size="sm" variant="secondary" onClick={() => baixarCsv("manutencoes", [["Impressora", "Tipo", "Serviço", "Descrição", "Situação", "Concluída", "Peças", "Mão de obra", "Total", "Horas paradas"],
              ...historico.map((m) => [nomeImp(m.impressora_id), m.tipo, SERVICOS_MANUTENCAO[m.servico], m.descricao, STATUS_MANUTENCAO[m.status], m.concluida_em?.slice(0, 10), csvNum(m.custo_pecas), csvNum(m.custo_mao_obra), csvNum(m.custo_total), csvNum(m.tempo_parado_h)])])}><Download className="h-4 w-4" /> CSV</Button></div>}>
            Histórico</CardTitle>
          {!historico.length ? <Empty texto="Nenhuma manutenção registrada" /> : <ListaMan lista={historico} nomeImp={nomeImp} edita={edita} onAnexos={setAnexos}
            onIniciar={(m) => acao(() => rpc("iniciar_manutencao", { p_id: m.id }), "Impressora em manutenção")}
            onConcluir={(m) => setConcluir({ m, pecas: "", mo: "", parado: "", material: "", qtd: "", obs: "", lancar: lanca })} onCancelar={(m) => setCancelar({ m, motivo: "" })} />}
        </Card>}

        {aba === "planos" && <Card>
          <CardTitle right={edita && <Button size="sm" onClick={() => setPlano({ impressora_id: dados.imps[0]?.id, servico: "lubrificacao", ativo: true })}><Plus className="h-4 w-4" /> Novo plano</Button>}>Planos preventivos</CardTitle>
          {!dados.planos.length ? <Empty texto="Nenhum plano. Ex.: limpeza a cada 30 dias, troca de bico a cada 500 h." /> : (
            <Table head={["Impressora", "Serviço", "A cada", "Última vez", "", ""]}>{dados.planos.map((p) => (
              <tr key={p.id} className={p.ativo ? "" : "opacity-50"}><Td className="font-medium">{nomeImp(p.impressora_id)}</Td><Td>{SERVICOS_MANUTENCAO[p.servico]}{p.descricao ? ` · ${p.descricao}` : ""}</Td>
                <Td>{[p.intervalo_horas && `${num(p.intervalo_horas, 1)} h de uso`, p.intervalo_dias && `${p.intervalo_dias} dias`].filter(Boolean).join(" ou ")}</Td>
                <Td>{data(p.ultima_data)}{p.ultima_horas != null && <span className="text-xs text-slate-500"> · {num(p.ultima_horas, 1)} h</span>}</Td>
                <Td>{!p.ativo && <Badge>Pausado</Badge>}</Td>
                <Td>{edita && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setPlano(p)}>Editar</Button>
                  <button aria-label="Excluir plano" className="rounded p-1.5 text-slate-400 hover:text-red-600" onClick={() => acao(() => q(sb().from("manutencao_planos").delete().eq("id", p.id)), "Plano excluído")}><Trash2 className="h-4 w-4" /></button></div>}</Td></tr>))}</Table>)}
        </Card>}
      </>}

      <Modal aberto={!!nova} titulo="Registrar manutenção" onClose={() => setNova(null)} largura="max-w-2xl">
        {nova && dados && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await acao(() => q(sb().from("manutencoes").insert({ empresa_id: app.empresa.id, impressora_id: nova.impressora_id, plano_id: nova.plano_id || null,
          tipo: nova.tipo, servico: nova.servico, descricao: nova.descricao, agendada_para: nova.agendada_para || null, responsavel: nova.responsavel || null, observacoes: nova.observacoes || null })), "Manutenção agendada")) setNova(null); }}>
          <Grid>
            <Field label="Impressora"><Select required value={nova.impressora_id || ""} onChange={(e) => setNova({ ...nova, impressora_id: e.target.value, plano_id: null })}>{dados.imps.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></Field>
            <Field label="Tipo"><Select value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value })}><option value="preventiva">Preventiva</option><option value="corretiva">Corretiva (algo quebrou)</option></Select></Field>
            <Field label="Serviço"><Select value={nova.servico} onChange={(e) => setNova({ ...nova, servico: e.target.value })}>{Object.entries(SERVICOS_MANUTENCAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Data prevista"><Input type="date" value={nova.agendada_para || ""} onChange={(e) => setNova({ ...nova, agendada_para: e.target.value })} /></Field>
            <Field label="Plano preventivo (opcional)" hint="Ao concluir, reinicia a contagem do plano"><Select value={nova.plano_id || ""} onChange={(e) => setNova({ ...nova, plano_id: e.target.value || null })}>
              <option value="">—</option>{dados.planos.filter((p) => p.impressora_id === nova.impressora_id).map((p) => <option key={p.id} value={p.id}>{SERVICOS_MANUTENCAO[p.servico]}{p.descricao ? ` · ${p.descricao}` : ""}</option>)}</Select></Field>
            <Field label="Responsável"><Input value={nova.responsavel || ""} onChange={(e) => setNova({ ...nova, responsavel: e.target.value })} placeholder="Quem vai fazer / técnico" /></Field>
          </Grid>
          <Field label="Descrição"><Input required value={nova.descricao || ""} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} placeholder="Ex.: bico entupido, trocar por 0.4 mm" /></Field>
          <Field label="Observações"><Textarea value={nova.observacoes || ""} onChange={(e) => setNova({ ...nova, observacoes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNova(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>

      <Modal aberto={!!concluir} titulo="Concluir manutenção" onClose={() => setConcluir(null)} largura="max-w-2xl">
        {concluir && dados && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await acao(() => rpc("concluir_manutencao", {
          p_id: concluir.m.id, p_custo_pecas: numOuNull(concluir.pecas), p_custo_mao_obra: numOuNull(concluir.mo) || 0, p_tempo_parado_h: numOuNull(concluir.parado),
          p_material: concluir.material || null, p_material_qtd: concluir.material ? numOuNull(concluir.qtd) : null, p_obs: concluir.obs || null, p_lancar: concluir.lancar }), "Manutenção concluída")) setConcluir(null); }}>
          <p className="text-sm"><b>{nomeImp(concluir.m.impressora_id)}</b> · {concluir.m.descricao}</p>
          {dados.mats.length > 0 && <Grid>
            <Field label="Peça / consumível do estoque (opcional)"><Select value={concluir.material} onChange={(e) => setConcluir({ ...concluir, material: e.target.value })}>
              <option value="">Nenhum</option>{dados.mats.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.cor ? ` · ${m.cor}` : ""} ({num(m.quantidade - m.quantidade_reservada)} {m.unidade})</option>)}</Select></Field>
            {concluir.material && <Field label={`Quantidade usada (${dados.mats.find((m) => m.id === concluir.material)?.unidade})`}><Input required inputMode="decimal" value={concluir.qtd} onChange={(e) => setConcluir({ ...concluir, qtd: e.target.value })} /></Field>}
          </Grid>}
          <Grid cols={3}>
            <Field label="Custo de peças (R$)" hint={concluir.material ? "Vazio = custo médio do estoque" : undefined}><Input inputMode="decimal" value={concluir.pecas} onChange={(e) => setConcluir({ ...concluir, pecas: e.target.value })} /></Field>
            <Field label="Mão de obra / técnico (R$)"><Input inputMode="decimal" value={concluir.mo} onChange={(e) => setConcluir({ ...concluir, mo: e.target.value })} /></Field>
            <Field label="Horas paradas" hint={concluir.m.iniciada_em ? "Vazio = desde o início" : "Vazio = 0"}><Input inputMode="decimal" value={concluir.parado} onChange={(e) => setConcluir({ ...concluir, parado: e.target.value })} /></Field>
          </Grid>
          <Field label="O que foi feito"><Textarea value={concluir.obs} onChange={(e) => setConcluir({ ...concluir, obs: e.target.value })} /></Field>
          {lanca ? <Checkbox label="Lançar o custo em Contas a pagar" hint="Peça que saiu do estoque não entra de novo (já foi paga na compra)" checked={concluir.lancar} onChange={(v) => setConcluir({ ...concluir, lancar: v })} />
            : <Aviso>O custo fica registrado na manutenção. Lançar no financeiro é com a administração.</Aviso>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConcluir(null)}>Voltar</Button><Button type="submit"><Check className="h-4 w-4" /> Concluir</Button></div>
        </form>}
      </Modal>

      <Confirmar aberto={!!cancelar} titulo="Cancelar manutenção" perigo confirmar="Cancelar manutenção" onCancel={() => setCancelar(null)}
        onOk={async () => { if (cancelar && await acao(() => rpc("cancelar_manutencao", { p_id: cancelar.m.id, p_motivo: cancelar.motivo }), "Manutenção cancelada")) setCancelar(null); }}>
        {cancelar && <div className="mt-2"><Field label="Motivo"><Input autoFocus value={cancelar.motivo} onChange={(e) => setCancelar({ ...cancelar, motivo: e.target.value })} /></Field></div>}
      </Confirmar>

      <Modal aberto={!!plano} titulo={plano?.id ? "Editar plano" : "Novo plano preventivo"} onClose={() => setPlano(null)}>
        {plano && dados && <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
          const v = { impressora_id: plano.impressora_id, servico: plano.servico, descricao: plano.descricao || null, intervalo_horas: plano.intervalo_horas || null, intervalo_dias: plano.intervalo_dias || null, ativo: plano.ativo ?? true };
          if (await acao(() => plano.id ? q(sb().from("manutencao_planos").update(v).eq("id", plano.id)) : q(sb().from("manutencao_planos").insert({ ...v, empresa_id: app.empresa.id })), "Plano salvo")) setPlano(null); }}>
          <Field label="Impressora"><Select value={plano.impressora_id || ""} disabled={!!plano.id} onChange={(e) => setPlano({ ...plano, impressora_id: e.target.value })}>{dados.imps.map((i) => <option key={i.id} value={i.id}>{i.nome} ({num(i.horas_acumuladas, 1)} h)</option>)}</Select></Field>
          <Field label="Serviço"><Select value={plano.servico} onChange={(e) => setPlano({ ...plano, servico: e.target.value })}>{Object.entries(SERVICOS_MANUTENCAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Detalhe (opcional)"><Input value={plano.descricao || ""} onChange={(e) => setPlano({ ...plano, descricao: e.target.value })} placeholder="Eixos Z e X" /></Field>
          <Grid><Field label="A cada (horas de impressão)"><Input inputMode="decimal" value={plano.intervalo_horas ?? ""} onChange={(e) => setPlano({ ...plano, intervalo_horas: numOuNull(e.target.value) })} /></Field>
            <Field label="ou a cada (dias)"><Input inputMode="numeric" value={plano.intervalo_dias ?? ""} onChange={(e) => setPlano({ ...plano, intervalo_dias: numOuNull(e.target.value) })} /></Field></Grid>
          <p className="text-xs text-slate-500">O que vencer primeiro gera o aviso. As horas vêm das ordens de produção finalizadas.</p>
          <Checkbox label="Plano ativo" checked={plano.ativo ?? true} onChange={(v) => setPlano({ ...plano, ativo: v })} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPlano(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>

      {anexos && <Anexos m={anexos} edita={edita} onClose={() => setAnexos(null)} />}
    </>
  );
}

function ListaMan({ lista, nomeImp, edita, onIniciar, onConcluir, onCancelar, onAnexos }: { lista: Man[]; nomeImp: (id: string) => string; edita: boolean;
  onIniciar: (m: Man) => void; onConcluir: (m: Man) => void; onCancelar: (m: Man) => void; onAnexos: (m: Man) => void }) {
  return (
    <Table head={["Impressora", "Manutenção", "Quando", "Situação", "Custo", ""]}>
      {lista.map((m) => (
        <tr key={m.id}>
          <Td className="font-medium">{nomeImp(m.impressora_id)}</Td>
          <Td><div>{m.descricao}</div><div className="text-xs text-slate-500">{m.tipo === "corretiva" ? "Corretiva" : "Preventiva"} · {SERVICOS_MANUTENCAO[m.servico]}{m.responsavel ? ` · ${m.responsavel}` : ""}</div></Td>
          <Td className="text-sm">{m.concluida_em ? dataHora(m.concluida_em) : m.iniciada_em ? `Desde ${dataHora(m.iniciada_em)}` : m.agendada_para ? <span className={cn(m.agendada_para < hojeISO() && "text-red-600")}>{data(m.agendada_para)}</span> : "—"}</Td>
          <Td><Badge tom={tomStatus(m.status)}>{STATUS_MANUTENCAO[m.status]}</Badge>{m.tempo_parado_h ? <div className="text-xs text-slate-500">{num(m.tempo_parado_h, 1)} h parada</div> : null}</Td>
          <Td className="tnum">{m.status === "concluida" ? brl(m.custo_total) : "—"}</Td>
          <Td><div className="flex justify-end gap-1">
            {edita && m.status === "agendada" && <Button size="sm" variant="secondary" onClick={() => onIniciar(m)}><Play className="h-3.5 w-3.5" /> Iniciar</Button>}
            {edita && ["agendada", "em_andamento"].includes(m.status) && <Button size="sm" onClick={() => onConcluir(m)}><Check className="h-3.5 w-3.5" /> Concluir</Button>}
            {edita && ["agendada", "em_andamento"].includes(m.status) && <button aria-label="Cancelar" className="rounded p-1.5 text-slate-400 hover:text-red-600" onClick={() => onCancelar(m)}><Ban className="h-4 w-4" /></button>}
            <button aria-label="Fotos e documentos" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onAnexos(m)}><Paperclip className="h-4 w-4" /></button>
          </div></Td>
        </tr>))}
    </Table>
  );
}

function Anexos({ m, edita, onClose }: { m: Man; edita: boolean; onClose: () => void }) {
  const app = useApp();
  const [enviando, setEnviando] = useState(false);
  const { dados, recarregar } = useDados(() => q<{ id: string; path: string; nome: string; created_at: string }[]>(sb().from("manutencao_anexos").select("*").eq("manutencao_id", m.id).order("created_at")), [m.id]);
  const enviar = async (arqs: FileList | null) => {
    if (!arqs?.length) return; setEnviando(true);
    try { for (const a of Array.from(arqs)) { const path = await enviarArquivo(app.empresa.id, "manutencao", a); await q(sb().from("manutencao_anexos").insert({ empresa_id: app.empresa.id, manutencao_id: m.id, path, nome: a.name.slice(0, 200) })); } toast("Arquivo anexado"); recarregar(); }
    catch (e) { erro(e); } finally { setEnviando(false); }
  };
  return (
    <Modal aberto titulo="Fotos, notas e documentos" onClose={onClose}>
      {m.observacoes && <p className="mb-3 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{m.observacoes}</p>}
      {!dados ? <Loading /> : !dados.length ? <Empty texto="Nenhum anexo" /> : (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">{dados.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2">
            <button className="truncate text-left text-brand-700 underline" onClick={async () => { try { window.open(await urlTemporaria(a.path), "_blank"); } catch (e) { erro(e); } }}>{a.nome}</button>
            {edita && <button aria-label="Remover" className="text-slate-400 hover:text-red-600" onClick={async () => { try { await q(sb().from("manutencao_anexos").delete().eq("id", a.id)); await sb().storage.from("empresa").remove([a.path]); recarregar(); } catch (e) { erro(e); } }}><Trash2 className="h-4 w-4" /></button>}
          </li>))}</ul>)}
      {edita && <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
        {enviando ? "Enviando…" : <><Paperclip className="h-4 w-4" /> Anexar foto ou PDF</>}
        <input type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => enviar(e.target.files)} /></label>}
      {!edita && <Aviso tom="amarelo"><AlertTriangle className="mr-1 inline h-4 w-4" />Só quem edita impressoras anexa arquivos.</Aviso>}
    </Modal>
  );
}
