"use client";
import { useCallback, useEffect, useState } from "react";
import { sb, rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { brl, data, dataHora, pode, STATUS_ASSINATURA, STATUS_EMPRESA, STATUS_FATURA } from "@/lib/utils";
import { useSessao } from "@/components/shell";
import { Badge, Button, Empty, Field, Input, Loading, Modal, Select, Table, Td, Textarea, tomStatus } from "@/components/ui";
import { cn } from "@/lib/utils";

export type Empresa = {
  id: string; nome: string; razao_social: string | null; documento: string | null; responsavel: string | null;
  email: string | null; telefone: string | null; endereco: string | null; cidade: string | null; uf: string | null; cep: string | null;
  status: string; criado_em: string; dono: string | null; usuarios: number; impressoras: number; ultimo_acesso: string | null; pedidos_30d: number;
  assinatura: { id: string; status: string; plano_id: string; plano: string; valor: number; desconto: number; periodicidade: string; teste_ate: string | null; proxima_cobranca: string | null } | null;
};
type Plano = { id: string; nome: string; preco_mensal: number; preco_anual: number | null; ativo: boolean; descontinuado: boolean };

const ABAS = ["Dados", "Assinatura", "Histórico", "Cobranças", "Notas internas", "Suporte"] as const;

export function EmpresaDetalhe({ empresa, onClose, onChange }: { empresa: Empresa; onClose: () => void; onChange: () => void }) {
  const [aba, setAba] = useState<(typeof ABAS)[number]>("Dados");
  return (
    <Modal aberto titulo={empresa.nome} onClose={onClose} largura="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tom={tomStatus(empresa.status)}>{STATUS_EMPRESA[empresa.status]}</Badge>
        <span className="text-slate-500">Cadastro {data(empresa.criado_em)} · {empresa.usuarios} usuário(s) · {empresa.impressoras} impressora(s) · {empresa.pedidos_30d} pedidos em 30 dias</span>
      </div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {ABAS.map((a) => (
          <button key={a} onClick={() => setAba(a)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", aba === a ? "border-brand-600 font-medium text-brand-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200")}>{a}</button>
        ))}
      </div>
      {aba === "Dados" && <Dados e={empresa} onChange={onChange} />}
      {aba === "Assinatura" && <Assinatura e={empresa} onChange={onChange} />}
      {aba === "Histórico" && <Historico e={empresa} />}
      {aba === "Cobranças" && <Cobrancas e={empresa} />}
      {aba === "Notas internas" && <Notas e={empresa} />}
      {aba === "Suporte" && <Suporte e={empresa} />}
    </Modal>
  );
}

function Dados({ e, onChange }: { e: Empresa; onChange: () => void }) {
  const { papel } = useSessao();
  const podeEditar = pode(papel, "editarEmpresa");
  const [f, setF] = useState({ nome: e.nome, razao_social: e.razao_social || "", documento: e.documento || "", responsavel: e.responsavel || "",
    email: e.email || "", telefone: e.telefone || "", endereco: e.endereco || "", cidade: e.cidade || "", uf: e.uf || "", cep: e.cep || "" });
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value });

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const doc = f.documento.replace(/\D/g, "");
    if (doc && doc.length !== 11 && doc.length !== 14) return toast("CPF deve ter 11 dígitos e CNPJ 14", "erro");
    if (f.uf && !/^[A-Za-z]{2}$/.test(f.uf)) return toast("UF deve ter 2 letras", "erro");
    setSalvando(true);
    const vazio = (v: string) => v.trim() || null;
    const { error } = await sb().from("empresas").update({
      nome: f.nome.trim(), razao_social: vazio(f.razao_social), documento: doc || null, responsavel: vazio(f.responsavel),
      email: vazio(f.email), telefone: vazio(f.telefone), endereco: vazio(f.endereco), cidade: vazio(f.cidade), uf: f.uf ? f.uf.toUpperCase() : null, cep: vazio(f.cep),
    }).eq("id", e.id);
    setSalvando(false);
    if (error) return erro(error);
    toast("Dados salvos"); onChange();
  };

  return (
    <form onSubmit={salvar} className="space-y-4">
      <fieldset disabled={!podeEditar} className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome fantasia"><Input required value={f.nome} onChange={set("nome")} /></Field>
        <Field label="Razão social"><Input value={f.razao_social} onChange={set("razao_social")} /></Field>
        <Field label="CPF ou CNPJ" hint="Somente números"><Input inputMode="numeric" value={f.documento} onChange={set("documento")} /></Field>
        <Field label="Responsável"><Input value={f.responsavel} onChange={set("responsavel")} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set("email")} placeholder={e.dono || ""} /></Field>
        <Field label="Telefone"><Input value={f.telefone} onChange={set("telefone")} /></Field>
        <Field label="Endereço"><Input value={f.endereco} onChange={set("endereco")} /></Field>
        <div className="grid grid-cols-[1fr_70px_110px] gap-3">
          <Field label="Cidade"><Input value={f.cidade} onChange={set("cidade")} /></Field>
          <Field label="UF"><Input maxLength={2} value={f.uf} onChange={set("uf")} /></Field>
          <Field label="CEP"><Input value={f.cep} onChange={set("cep")} /></Field>
        </div>
      </fieldset>
      {podeEditar ? <Button type="submit" loading={salvando}>Salvar dados</Button> : <p className="text-sm text-slate-500">Seu perfil só pode visualizar.</p>}
    </form>
  );
}

function Assinatura({ e, onChange }: { e: Empresa; onChange: () => void }) {
  const { papel } = useSessao();
  const podeGerir = pode(papel, "gerirAssinaturas");
  const a = e.assinatura;
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [plano, setPlano] = useState(a?.plano_id || "");
  const [periodicidade, setPeriodicidade] = useState(a?.periodicidade || "mensal");
  const [dias, setDias] = useState("");
  const [desconto, setDesconto] = useState(String(a?.desconto ?? 0));
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<null | { status: string; texto: string }>(null);

  useEffect(() => { sb().from("planos").select("id,nome,preco_mensal,preco_anual,ativo,descontinuado").order("ordem").then(({ data }) => setPlanos((data as Plano[]) || [])); }, []);

  const executar = async (args: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    try { await rpc("admin_alterar_assinatura", { p_empresa: e.id, p_motivo: motivo.trim() || null, ...args }); toast(ok); setMotivo(""); setDias(""); onChange(); }
    catch (x) { erro(x); } finally { setOcupado(false); setConfirmar(null); }
  };

  if (!a) return <Empty texto="Esta empresa não tem assinatura vigente." />;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-4 dark:bg-slate-800/50">
        <div><div className="text-xs text-slate-500">Plano</div><div className="font-medium">{a.plano}</div></div>
        <div><div className="text-xs text-slate-500">Status</div><Badge tom={tomStatus(a.status)}>{STATUS_ASSINATURA[a.status]}</Badge></div>
        <div><div className="text-xs text-slate-500">Valor</div><div className="tnum font-medium">{brl(a.valor)} / {a.periodicidade === "anual" ? "ano" : "mês"}{a.desconto > 0 && <span className="text-emerald-600"> (−{a.desconto}%)</span>}</div></div>
        <div><div className="text-xs text-slate-500">{a.status === "teste" ? "Teste até" : "Próxima cobrança"}</div><div className="tnum font-medium">{data(a.status === "teste" ? a.teste_ate : a.proxima_cobranca)}</div></div>
      </div>
      {!podeGerir ? <p className="text-sm text-slate-500">Seu perfil não altera assinaturas.</p> : (
        <>
          <Field label="Motivo (fica registrado na auditoria)"><Input value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Ex.: cliente pediu upgrade por WhatsApp" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-sm font-medium">Plano e periodicidade</div>
              <Select value={plano} onChange={(x) => setPlano(x.target.value)}>
                {planos.filter((p) => (p.ativo && !p.descontinuado) || p.id === a.plano_id).map((p) => <option key={p.id} value={p.id}>{p.nome} — {brl(p.preco_mensal)}/mês</option>)}
              </Select>
              <Select value={periodicidade} onChange={(x) => setPeriodicidade(x.target.value)}><option value="mensal">Mensal</option><option value="anual">Anual</option></Select>
              <Button size="sm" loading={ocupado} disabled={plano === a.plano_id && periodicidade === a.periodicidade}
                onClick={() => executar({ p_plano: plano !== a.plano_id ? plano : null, p_periodicidade: periodicidade !== a.periodicidade ? periodicidade : null }, "Plano atualizado")}>Aplicar</Button>
              <p className="text-xs text-slate-500">A proporcionalidade da cobrança será calculada pelo gateway quando ele for integrado.</p>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="text-sm font-medium">Teste e desconto</div>
              <div className="flex gap-2"><Input type="number" min={1} max={90} placeholder="Dias extras de teste" value={dias} onChange={(x) => setDias(x.target.value)} />
                <Button size="sm" variant="secondary" loading={ocupado} disabled={!dias} onClick={() => executar({ p_dias_extra_teste: Number(dias) }, "Teste estendido")}>Conceder</Button></div>
              <div className="flex gap-2"><Input type="number" min={0} max={100} step="0.5" value={desconto} onChange={(x) => setDesconto(x.target.value)} aria-label="Desconto em %" />
                <Button size="sm" variant="secondary" loading={ocupado} onClick={() => executar({ p_desconto: Number(desconto) }, "Desconto aplicado")}>Aplicar %</Button></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.status !== "ativa" && <Button size="sm" onClick={() => setConfirmar({ status: "ativa", texto: "Ativar a assinatura e liberar a conta?" })}>Ativar</Button>}
            {a.status !== "suspensa" && <Button size="sm" variant="secondary" onClick={() => setConfirmar({ status: "suspensa", texto: "Suspender a conta? A empresa continua vendo os dados, mas não consegue lançar nada. Nenhum dado é apagado." })}>Suspender</Button>}
            <Button size="sm" variant="danger" onClick={() => setConfirmar({ status: "cancelada", texto: "Cancelar a assinatura? A conta fica bloqueada para lançamentos. Os dados não são apagados." })}>Cancelar assinatura</Button>
          </div>
        </>
      )}
      <Modal aberto={!!confirmar} titulo="Confirmar" onClose={() => setConfirmar(null)}>
        <p className="mb-4 text-sm">{confirmar?.texto}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmar(null)}>Voltar</Button>
          <Button variant={confirmar?.status === "ativa" ? "primary" : "danger"} loading={ocupado} onClick={() => executar({ p_status: confirmar!.status }, "Status atualizado")}>Confirmar</Button>
        </div>
      </Modal>
    </div>
  );
}

type Hist = { id: number; evento: string; status: string | null; valor: number | null; created_at: string; detalhes: Record<string, unknown> | null; planos: { nome: string } | null };
const EVENTOS: Record<string, string> = { criada: "Assinatura criada", troca_plano: "Troca de plano", teste_estendido: "Teste estendido", desconto: "Desconto alterado", alteracao: "Alteração" };

function Historico({ e }: { e: Empresa }) {
  const [h, setH] = useState<Hist[] | null>(null);
  useEffect(() => {
    sb().from("assinatura_historico").select("id,evento,status,valor,created_at,detalhes,planos(nome)").eq("empresa_id", e.id).order("created_at", { ascending: false })
      .then(({ data, error }) => { if (error) erro(error); setH((data as unknown as Hist[]) || []); });
  }, [e.id]);
  if (!h) return <Loading />;
  if (!h.length) return <Empty texto="Sem histórico." />;
  return (
    <Table head={["Quando", "Evento", "Plano", "Status", "Valor"]}>
      {h.map((x) => (
        <tr key={x.id}><Td className="whitespace-nowrap">{dataHora(x.created_at)}</Td>
          <Td>{EVENTOS[x.evento] || (x.evento.startsWith("status_") ? `Status → ${STATUS_ASSINATURA[x.evento.slice(7)] || x.evento.slice(7)}` : x.evento)}</Td>
          <Td>{x.planos?.nome || "—"}</Td><Td>{x.status ? <Badge tom={tomStatus(x.status)}>{STATUS_ASSINATURA[x.status]}</Badge> : "—"}</Td><Td className="tnum">{x.valor != null ? brl(x.valor) : "—"}</Td></tr>
      ))}
    </Table>
  );
}

type Fatura = { id: string; descricao: string | null; valor: number; vencimento: string; status: string; valor_pago: number | null; pago_em: string | null };
function Cobrancas({ e }: { e: Empresa }) {
  const [f, setF] = useState<Fatura[] | null>(null);
  useEffect(() => {
    sb().from("faturas").select("id,descricao,valor,vencimento,status,valor_pago,pago_em").eq("empresa_id", e.id).order("vencimento", { ascending: false })
      .then(({ data, error }) => { if (error) erro(error); setF((data as Fatura[]) || []); });
  }, [e.id]);
  if (!f) return <Loading />;
  if (!f.length) return <Empty texto="Nenhuma cobrança ainda. As faturas aparecem aqui quando o gateway de pagamento estiver integrado." />;
  return (
    <Table head={["Vencimento", "Descrição", "Valor", "Status", "Pago em"]}>
      {f.map((x) => (
        <tr key={x.id}><Td className="tnum">{data(x.vencimento)}</Td><Td>{x.descricao || "Assinatura"}</Td><Td className="tnum">{brl(x.valor)}</Td>
          <Td><Badge tom={tomStatus(x.status)}>{STATUS_FATURA[x.status]}</Badge></Td><Td className="whitespace-nowrap">{dataHora(x.pago_em)}</Td></tr>
      ))}
    </Table>
  );
}

type Nota = { id: string; texto: string; created_at: string };
function Notas({ e }: { e: Empresa }) {
  const { userId } = useSessao();
  const [n, setN] = useState<Nota[] | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(() => {
    sb().from("empresa_notas_internas").select("id,texto,created_at").eq("empresa_id", e.id).order("created_at", { ascending: false })
      .then(({ data, error }) => { if (error) erro(error); setN((data as Nota[]) || []); });
  }, [e.id]);
  useEffect(carregar, [carregar]);
  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!texto.trim()) return;
    setSalvando(true);
    const { error } = await sb().from("empresa_notas_internas").insert({ empresa_id: e.id, autor_id: userId, texto: texto.trim() });
    setSalvando(false);
    if (error) return erro(error);
    setTexto(""); toast("Nota registrada"); carregar();
  };
  return (
    <div className="space-y-4">
      <form onSubmit={salvar} className="space-y-2">
        <Textarea value={texto} onChange={(x) => setTexto(x.target.value)} maxLength={5000} placeholder="Observação interna (o cliente não vê)" />
        <Button size="sm" type="submit" loading={salvando}>Adicionar nota</Button>
      </form>
      {!n ? <Loading /> : !n.length ? <Empty texto="Nenhuma nota." /> : (
        <ul className="space-y-2">{n.map((x) => <li key={x.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><div className="whitespace-pre-wrap">{x.texto}</div><div className="mt-1 text-xs text-slate-500">{dataHora(x.created_at)}</div></li>)}</ul>
      )}
    </div>
  );
}

type Resumo = { pedidos: { numero: number; descricao: string | null; status: string; valor_total: number; created_at: string }[]; clientes: number; itens: { nome: string; quantidade: number; unidade: string }[] };
function Suporte({ e }: { e: Empresa }) {
  const { papel } = useSessao();
  const [motivo, setMotivo] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [r, setR] = useState<Resumo | null>(null);

  const carregarLoja = async () => {
    const [p, c, m] = await Promise.all([
      sb().from("pedidos").select("numero,descricao,status,valor_total,created_at").eq("empresa_id", e.id).order("created_at", { ascending: false }).limit(20),
      sb().from("clientes").select("id", { count: "exact", head: true }).eq("empresa_id", e.id),
      sb().from("materiais").select("nome,quantidade,unidade").eq("empresa_id", e.id).order("nome").limit(50),
    ]);
    setR({ pedidos: (p.data as Resumo["pedidos"]) || [], clientes: c.count || 0, itens: (m.data as Resumo["itens"]) || [] });
  };
  const iniciar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setOcupado(true);
    try { await rpc("iniciar_acesso_suporte", { p_empresa: e.id, p_motivo: motivo, p_horas: 2 }); setAtivo(true); toast("Acesso de suporte iniciado (2 horas, registrado na auditoria)"); await carregarLoja(); }
    catch (x) { erro(x); } finally { setOcupado(false); }
  };
  const encerrar = async () => { try { await rpc("encerrar_acesso_suporte"); setAtivo(false); setR(null); toast("Acesso encerrado"); } catch (x) { erro(x); } };

  if (!pode(papel, "acessarLoja")) return <p className="text-sm text-slate-500">Seu perfil não pode acessar dados das lojas.</p>;
  if (!ativo) return (
    <form onSubmit={iniciar} className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">Os dados comerciais da empresa (pedidos, clientes, estoque) só ficam visíveis durante um acesso de suporte. O motivo, quem acessou e quando ficam registrados na auditoria. O acesso é somente leitura e expira em 2 horas.</p>
      <Field label="Motivo do acesso"><Textarea required minLength={10} value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Ex.: cliente relatou que o estoque não atualiza (chamado por WhatsApp em 08/11)" /></Field>
      <Button type="submit" loading={ocupado}>Iniciar acesso de suporte</Button>
    </form>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
        <span>Acesso de suporte ativo · somente leitura · registrado</span>
        <Button size="sm" variant="secondary" onClick={encerrar}>Encerrar acesso</Button>
      </div>
      {!r ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div><div className="mb-2 text-sm font-medium">Últimos pedidos · {r.clientes} cliente(s)</div>
            {!r.pedidos.length ? <Empty texto="Sem pedidos." /> : <Table head={["#", "Descrição", "Status", "Valor"]}>{r.pedidos.map((p) => <tr key={p.numero}><Td>{p.numero}</Td><Td>{p.descricao}</Td><Td>{p.status}</Td><Td className="tnum">{brl(p.valor_total)}</Td></tr>)}</Table>}</div>
          <div><div className="mb-2 text-sm font-medium">Itens em estoque</div>
            {!r.itens.length ? <Empty texto="Sem itens." /> : <Table head={["Item", "Saldo"]}>{r.itens.map((m, i) => <tr key={i}><Td>{m.nome}</Td><Td className="tnum">{Number(m.quantidade).toLocaleString("pt-BR")} {m.unidade}</Td></tr>)}</Table>}</div>
        </div>
      )}
    </div>
  );
}
