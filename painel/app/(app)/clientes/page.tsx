"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, MessageCircle, Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, data, linkWhats, numOuNull, ETAPAS_CRM, STATUS_PEDIDO, STATUS_ORCAMENTO, UFS, cn } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Tabs, Kpi, Confirmar, Paginacao } from "@/components/ui";

type Cliente = {
  id: string; nome: string; tipo_pessoa: string; documento: string | null; telefone: string | null; whatsapp: string | null; email: string | null;
  endereco: string | null; cidade: string | null; uf: string | null; cep: string | null; observacoes: string | null; observacoes_internas: string | null;
  etiquetas: string[]; margem_pct: number | null; arquivado: boolean; created_at: string;
};
type Resumo = { cliente_id: string; pedidos: number; total_comprado: number; total_pago: number; ticket_medio: number | null; ultima_compra: string | null };
type Oport = { id: string; cliente_id: string; titulo: string; etapa: string; valor_estimado: number | null; motivo_perda: string | null; observacoes: string | null; updated_at: string; clientes?: { nome: string } };
const vazio = { nome: "", tipo_pessoa: "fisica", documento: "", telefone: "", whatsapp: "", email: "", endereco: "", cidade: "", uf: "", cep: "", observacoes: "", observacoes_internas: "", etiquetas: "", margem_pct: "" };
const POR_PAGINA = 25;

export default function Clientes() {
  return <Exige perm="clientes_ver"><ClientesConteudo /></Exige>;
}

function ClientesConteudo() {
  const app = useApp();
  const pode = app.pode("clientes_editar") && app.podeEscrever;
  const idUrl = useParam("id");
  const [aba, setAba] = useState<"lista" | "crm">("lista");
  const [busca, setBusca] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [arquivados, setArquivados] = useState(false);
  const [ordem, setOrdem] = useState<"nome" | "recentes" | "maiores">("nome");
  const [pagina, setPagina] = useState(1);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Cliente | null>(null);
  const [excluir, setExcluir] = useState<Cliente | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [c, r] = await Promise.all([
      q<Cliente[]>(sb().from("clientes").select("*").eq("empresa_id", app.empresa.id).order("nome").limit(5000)),
      q<Resumo[]>(sb().from("clientes_resumo").select("*").eq("empresa_id", app.empresa.id).limit(5000)),
    ]);
    return { clientes: c, resumo: Object.fromEntries(r.map((x) => [x.cliente_id, x])) as Record<string, Resumo> };
  }, [app.empresa.id]);

  useEffect(() => { if (idUrl && dados) { const c = dados.clientes.find((x) => x.id === idUrl); if (c) setDetalhe(c); } }, [idUrl, dados]);

  const etiquetas = useMemo(() => Array.from(new Set((dados?.clientes || []).flatMap((c) => c.etiquetas || []))).sort(), [dados]);
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const l = (dados?.clientes || []).filter((c) => c.arquivado === arquivados && (!etiqueta || c.etiquetas?.includes(etiqueta)) &&
      (!t || [c.nome, c.email, c.telefone, c.whatsapp, c.documento, c.cidade].some((v) => v?.toLowerCase().includes(t))));
    const r = dados?.resumo || {};
    if (ordem === "recentes") l.sort((a, b) => (r[b.id]?.ultima_compra || b.created_at).localeCompare(r[a.id]?.ultima_compra || a.created_at));
    if (ordem === "maiores") l.sort((a, b) => (r[b.id]?.total_comprado || 0) - (r[a.id]?.total_comprado || 0));
    return l;
  }, [dados, busca, etiqueta, arquivados, ordem]);
  useEffect(() => setPagina(1), [busca, etiqueta, arquivados, ordem]);

  const abrirNovo = () => { setEditId(null); setForm({ ...vazio }); };
  const abrirEditar = (c: Cliente) => {
    setEditId(c.id);
    setForm(Object.fromEntries(Object.keys(vazio).map((k) => [k, k === "etiquetas" ? (c.etiquetas || []).join(", ") : String((c as unknown as Record<string, unknown>)[k] ?? "")])));
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setSalvando(true);
    try {
      const reg = {
        nome: form.nome.trim(), tipo_pessoa: form.tipo_pessoa, documento: form.documento || null, telefone: form.telefone || null, whatsapp: form.whatsapp || null,
        email: form.email || null, endereco: form.endereco || null, cidade: form.cidade || null, uf: form.uf || null, cep: form.cep || null,
        observacoes: form.observacoes || null, observacoes_internas: form.observacoes_internas || null, margem_pct: numOuNull(form.margem_pct),
        etiquetas: form.etiquetas.split(",").map((x) => x.trim()).filter(Boolean),
      };
      if (editId) await q(sb().from("clientes").update(reg).eq("id", editId));
      else await q(sb().from("clientes").insert({ ...reg, empresa_id: app.empresa.id }));
      toast(editId ? "Cliente atualizado" : "Cliente cadastrado"); setForm(null); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const arquivar = async (c: Cliente) => {
    try { await q(sb().from("clientes").update({ arquivado: !c.arquivado }).eq("id", c.id)); toast(c.arquivado ? "Cliente reativado" : "Cliente arquivado"); recarregar(); } catch (e) { erro(e); }
  };
  const apagar = async () => {
    if (!excluir) return;
    try { await q(sb().from("clientes").delete().eq("id", excluir.id)); toast("Cliente excluído"); setExcluir(null); setDetalhe(null); recarregar(); } catch (e) { erro(e); }
  };

  return (
    <>
      <PageHeader titulo="Clientes" sub="Cadastro, histórico de compras e funil comercial" acoes={pode && <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Novo cliente</Button>} />
      <Tabs abas={[["lista", "Clientes"], ["crm", "Funil comercial (CRM)"]]} ativa={aba} onChange={setAba} />
      {aba === "crm" ? <Funil clientes={dados?.clientes || []} pode={pode} /> : (
        <Card>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input placeholder="Buscar por nome, telefone, e-mail, documento ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)} className="min-w-60 flex-1" aria-label="Buscar" />
            <Select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} className="w-44" aria-label="Etiqueta"><option value="">Todas as etiquetas</option>{etiquetas.map((t) => <option key={t}>{t}</option>)}</Select>
            <Select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} className="w-44" aria-label="Ordenar"><option value="nome">Ordem alfabética</option><option value="recentes">Compras recentes</option><option value="maiores">Quem mais compra</option></Select>
            <Select value={arquivados ? "1" : "0"} onChange={(e) => setArquivados(e.target.value === "1")} className="w-36" aria-label="Situação"><option value="0">Ativos</option><option value="1">Arquivados</option></Select>
          </div>
          {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
          {carregando && !dados ? <Loading /> : filtrados.length === 0 ? <Empty texto={busca || etiqueta ? "Nenhum cliente encontrado" : "Nenhum cliente ainda. Cadastre o primeiro!"} /> : (
            <>
              <Table head={["Cliente", "Contato", "Etiquetas", "Total comprado", "Última compra", ""]}>
                {filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((c) => {
                  const r = dados!.resumo[c.id];
                  const w = linkWhats(c.whatsapp || c.telefone);
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setDetalhe(c)}>
                      <Td><div className="font-medium">{c.nome}</div><div className="text-xs text-slate-500">{[c.cidade, c.uf].filter(Boolean).join(" / ") || (c.tipo_pessoa === "juridica" ? "Pessoa jurídica" : "Pessoa física")}</div></Td>
                      <Td className="text-slate-600 dark:text-slate-300">{c.whatsapp || c.telefone || c.email || "—"}</Td>
                      <Td><div className="flex flex-wrap gap-1">{c.etiquetas?.map((t) => <Badge key={t}>{t}</Badge>)}</div></Td>
                      <Td className="tnum">{brl(r?.total_comprado)}</Td>
                      <Td>{data(r?.ultima_compra)}</Td>
                      <Td className="text-right" >
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {w && <a href={w} target="_blank" rel="noreferrer" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a>}
                          {pode && <button onClick={() => abrirEditar(c)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
              <Paginacao pagina={pagina} total={filtrados.length} porPagina={POR_PAGINA} onChange={setPagina} />
            </>
          )}
        </Card>
      )}

      <Modal aberto={!!form} titulo={editId ? "Editar cliente" : "Novo cliente"} onClose={() => setForm(null)} largura="max-w-2xl">
        {form && (
          <form onSubmit={salvar} className="space-y-3">
            <Grid>
              <Field label="Nome"><Input required maxLength={200} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field>
              <Field label="Tipo"><Select value={form.tipo_pessoa} onChange={(e) => setForm({ ...form, tipo_pessoa: e.target.value })}><option value="fisica">Pessoa física</option><option value="juridica">Pessoa jurídica</option></Select></Field>
              <Field label={form.tipo_pessoa === "juridica" ? "CNPJ" : "CPF"}><Input maxLength={20} value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} /></Field>
              <Field label="WhatsApp"><Input inputMode="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
              <Field label="Telefone"><Input inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
              <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </Grid>
            <Field label="Endereço"><Input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></Field>
            <Grid cols={3}>
              <Field label="Cidade"><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></Field>
              <Field label="Estado"><Select value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
              <Field label="CEP"><Input maxLength={10} value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} /></Field>
            </Grid>
            <Grid>
              <Field label="Etiquetas" hint="Separe por vírgula: ex. revenda, cosplay"><Input value={form.etiquetas} onChange={(e) => setForm({ ...form, etiquetas: e.target.value })} list="etiquetas-cli" /></Field>
              {(app.pode("descontos_aprovar") || app.pode("config_editar")) && <Field label="Margem especial (%)" hint="Opcional. Substitui a margem padrão nos orçamentos"><Input inputMode="decimal" value={form.margem_pct} onChange={(e) => setForm({ ...form, margem_pct: e.target.value })} /></Field>}
            </Grid>
            <datalist id="etiquetas-cli">{etiquetas.map((t) => <option key={t} value={t} />)}</datalist>
            <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
            <Field label="Observações internas" hint="Só a equipe vê"><Textarea value={form.observacoes_internas} onChange={(e) => setForm({ ...form, observacoes_internas: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Salvar</Button></div>
          </form>
        )}
      </Modal>

      {detalhe && <DetalheCliente c={detalhe} resumo={dados?.resumo[detalhe.id]} pode={pode} onClose={() => setDetalhe(null)}
        onEditar={() => { abrirEditar(detalhe); setDetalhe(null); }} onArquivar={() => { arquivar(detalhe); setDetalhe(null); }} onExcluir={() => setExcluir(detalhe)} />}
      <Confirmar aberto={!!excluir} titulo="Excluir cliente" perigo confirmar="Excluir" onCancel={() => setExcluir(null)} onOk={apagar}
        texto={<>Excluir <b>{excluir?.nome}</b>? Os pedidos dele continuam, mas ficam sem cliente. Prefira <b>arquivar</b> se ele já comprou.</>} />
    </>
  );
}

function DetalheCliente({ c, resumo, pode, onClose, onEditar, onArquivar, onExcluir }:
  { c: Cliente; resumo?: Resumo; pode: boolean; onClose: () => void; onEditar: () => void; onArquivar: () => void; onExcluir: () => void }) {
  const app = useApp();
  const { dados, carregando } = useDados(async () => {
    const [p, o] = await Promise.all([
      q<{ id: string; numero: number; descricao: string; status: string; valor_total: number; valor_pago: number; created_at: string }[]>(
        sb().from("pedidos").select("id,numero,descricao,status,valor_total,valor_pago,created_at").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(100)),
      app.pode("orcamentos_ver") || app.pode("orcamentos_criar")
        ? q<{ id: string; numero: number; titulo: string; status: string; total: number; created_at: string }[]>(
          sb().from("orcamentos").select("id,numero,titulo,status,total,created_at").eq("cliente_id", c.id).order("created_at", { ascending: false }).limit(100))
        : Promise.resolve([]),
    ]);
    return { pedidos: p, orcamentos: o };
  }, [c.id]);
  const [aba, setAba] = useState<"pedidos" | "orcamentos" | "pagamentos" | "dados">("pedidos");
  const w = linkWhats(c.whatsapp || c.telefone, `Olá ${c.nome.split(" ")[0]}!`);
  return (
    <Modal aberto titulo={c.nome} onClose={onClose} largura="max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2">
        {w && <a href={w} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp</Button></a>}
        {(app.pode("orcamentos_criar")) && <Link href={`/orcamentos/editar/?cliente=${c.id}`}><Button size="sm" variant="secondary"><Plus className="h-4 w-4" /> Orçamento</Button></Link>}
        {pode && <Button size="sm" variant="secondary" onClick={onEditar}><Pencil className="h-4 w-4" /> Editar</Button>}
        {pode && <Button size="sm" variant="secondary" onClick={onArquivar}>{c.arquivado ? <><ArchiveRestore className="h-4 w-4" /> Reativar</> : <><Archive className="h-4 w-4" /> Arquivar</>}</Button>}
        {pode && <Button size="sm" variant="ghost" onClick={onExcluir} className="text-red-600"><Trash2 className="h-4 w-4" /> Excluir</Button>}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total comprado" valor={brl(resumo?.total_comprado)} />
        <Kpi label="Ticket médio" valor={brl(resumo?.ticket_medio)} />
        <Kpi label="Pedidos" valor={resumo?.pedidos || 0} />
        <Kpi label="Última compra" valor={<span className="text-base">{data(resumo?.ultima_compra)}</span>} />
      </div>
      <Tabs abas={[["pedidos", "Pedidos"], ["orcamentos", "Orçamentos"], ["pagamentos", "Pagamentos"], ["dados", "Dados"]]} ativa={aba} onChange={setAba} />
      {carregando ? <Loading /> : aba === "pedidos" ? (
        dados?.pedidos.length ? <Table head={["Pedido", "Data", "Situação", "Valor"]}>{dados.pedidos.map((p) => (
          <tr key={p.id}><Td><Link href={`/pedidos/?id=${p.id}`} className="text-brand-600 hover:underline">#{p.numero}</Link> {p.descricao}</Td><Td>{data(p.created_at)}</Td>
            <Td><Badge tom={tomStatus(p.status)}>{STATUS_PEDIDO[p.status]}</Badge></Td><Td className="tnum">{brl(p.valor_total)}</Td></tr>))}</Table> : <Empty texto="Nenhum pedido" />
      ) : aba === "orcamentos" ? (
        dados?.orcamentos.length ? <Table head={["Orçamento", "Data", "Situação", "Total"]}>{dados.orcamentos.map((o) => (
          <tr key={o.id}><Td><Link href={`/orcamentos/editar/?id=${o.id}`} className="text-brand-600 hover:underline">#{o.numero}</Link> {o.titulo}</Td><Td>{data(o.created_at)}</Td>
            <Td><Badge tom={tomStatus(o.status)}>{STATUS_ORCAMENTO[o.status]}</Badge></Td><Td className="tnum">{brl(o.total)}</Td></tr>))}</Table> : <Empty texto="Nenhum orçamento" />
      ) : aba === "pagamentos" ? (
        dados?.pedidos.filter((p) => p.valor_pago > 0 || p.valor_total > 0).length ? (
          <Table head={["Pedido", "Valor", "Pago", "Em aberto"]}>{dados.pedidos.filter((p) => p.status !== "cancelado").map((p) => (
            <tr key={p.id}><Td>#{p.numero}</Td><Td className="tnum">{brl(p.valor_total)}</Td><Td className="tnum text-emerald-700">{brl(p.valor_pago)}</Td>
              <Td className={cn("tnum", p.valor_total - p.valor_pago > 0 && "text-amber-700")}>{brl(Math.max(p.valor_total - p.valor_pago, 0))}</Td></tr>))}</Table>
        ) : <Empty texto="Nenhum pagamento registrado" />
      ) : (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {([["Tipo", c.tipo_pessoa === "juridica" ? "Pessoa jurídica" : "Pessoa física"], ["Documento", c.documento], ["WhatsApp", c.whatsapp], ["Telefone", c.telefone], ["E-mail", c.email],
            ["Endereço", [c.endereco, c.cidade, c.uf, c.cep].filter(Boolean).join(", ")], ["Etiquetas", c.etiquetas?.join(", ")], ["Margem especial", c.margem_pct != null ? `${c.margem_pct}%` : null],
            ["Cliente desde", data(c.created_at)], ["Observações", c.observacoes], ["Observações internas", c.observacoes_internas]] as [string, string | null][]).map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="whitespace-pre-wrap">{v || "—"}</dd></div>
          ))}
        </dl>
      )}
    </Modal>
  );
}

function Funil({ clientes, pode }: { clientes: Cliente[]; pode: boolean }) {
  const app = useApp();
  const [form, setForm] = useState<{ id?: string; cliente_id: string; titulo: string; etapa: string; valor_estimado: string; motivo_perda: string; observacoes: string } | null>(null);
  const [perda, setPerda] = useState<{ op: Oport; motivo: string } | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(() =>
    q<Oport[]>(sb().from("crm_oportunidades").select("*, clientes(nome)").eq("empresa_id", app.empresa.id).order("updated_at", { ascending: false }).limit(1000)), [app.empresa.id]);
  const mover = async (op: Oport, etapa: string, motivo?: string) => {
    if (etapa === "perdido" && !motivo) { setPerda({ op, motivo: "" }); return; }
    try { await q(sb().from("crm_oportunidades").update({ etapa, motivo_perda: etapa === "perdido" ? motivo : null }).eq("id", op.id)); setPerda(null); recarregar(); } catch (e) { erro(e); }
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return;
    try {
      const reg = { cliente_id: form.cliente_id, titulo: form.titulo, etapa: form.etapa, valor_estimado: numOuNull(form.valor_estimado), motivo_perda: form.etapa === "perdido" ? form.motivo_perda : null, observacoes: form.observacoes || null };
      if (form.id) await q(sb().from("crm_oportunidades").update(reg).eq("id", form.id));
      else await q(sb().from("crm_oportunidades").insert({ ...reg, empresa_id: app.empresa.id }));
      toast("Oportunidade salva"); setForm(null); recarregar();
    } catch (e2) { erro(e2); }
  };
  if (falha) return <ErrorBox erro={falha} onRetry={recarregar} />;
  if (carregando && !dados) return <Loading />;
  return (
    <>
      {pode && <div className="mb-3"><Button size="sm" onClick={() => setForm({ cliente_id: clientes[0]?.id || "", titulo: "", etapa: "novo_contato", valor_estimado: "", motivo_perda: "", observacoes: "" })} disabled={!clientes.length}><Plus className="h-4 w-4" /> Nova oportunidade</Button>
        {!clientes.length && <span className="ml-2 text-sm text-slate-500">Cadastre um cliente primeiro.</span>}</div>}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {Object.entries(ETAPAS_CRM).map(([etapa, label]) => {
          const lista = (dados || []).filter((o) => o.etapa === etapa);
          return (
            <div key={etapa} className="w-64 shrink-0 rounded-xl bg-slate-100 p-2 dark:bg-slate-900"
              onDragOver={(e) => pode && e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text"); const op = dados?.find((o) => o.id === id); if (op && op.etapa !== etapa) mover(op, etapa); }}>
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold"><span>{label}</span><span className="text-xs text-slate-500">{lista.length} · {brl(lista.reduce((s, o) => s + (o.valor_estimado || 0), 0))}</span></div>
              <div className="space-y-2">
                {lista.map((o) => (
                  <div key={o.id} draggable={pode} onDragStart={(e) => e.dataTransfer.setData("text", o.id)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <button className="w-full text-left" onClick={() => pode && setForm({ id: o.id, cliente_id: o.cliente_id, titulo: o.titulo, etapa: o.etapa, valor_estimado: o.valor_estimado?.toString() || "", motivo_perda: o.motivo_perda || "", observacoes: o.observacoes || "" })}>
                      <div className="font-medium">{o.titulo}</div><div className="text-xs text-slate-500">{o.clientes?.nome}</div>
                      {o.valor_estimado != null && <div className="tnum mt-1 text-xs">{brl(o.valor_estimado)}</div>}
                      {o.motivo_perda && <div className="mt-1 text-xs text-red-600">Motivo: {o.motivo_perda}</div>}
                    </button>
                    {pode && <Select aria-label="Mover para" value={o.etapa} onChange={(e) => mover(o, e.target.value)} className="mt-2 h-8 text-xs">
                      {Object.entries(ETAPAS_CRM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Modal aberto={!!form} titulo={form?.id ? "Oportunidade" : "Nova oportunidade"} onClose={() => setForm(null)}>
        {form && <form onSubmit={salvar} className="space-y-3">
          <Field label="Cliente"><Select required value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}>{clientes.filter((c) => !c.arquivado).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
          <Field label="O que o cliente quer"><Input required maxLength={200} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></Field>
          <Grid><Field label="Etapa"><Select value={form.etapa} onChange={(e) => setForm({ ...form, etapa: e.target.value })}>{Object.entries(ETAPAS_CRM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Valor estimado (R$)"><Input inputMode="decimal" value={form.valor_estimado} onChange={(e) => setForm({ ...form, valor_estimado: e.target.value })} /></Field></Grid>
          {form.etapa === "perdido" && <Field label="Motivo da perda"><Input required minLength={3} value={form.motivo_perda} onChange={(e) => setForm({ ...form, motivo_perda: e.target.value })} /></Field>}
          <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
          <div className="flex justify-between gap-2">
            {form.id ? <Button type="button" variant="ghost" className="text-red-600" onClick={async () => { try { await q(sb().from("crm_oportunidades").delete().eq("id", form.id!)); setForm(null); recarregar(); } catch (e) { erro(e); } }}>Excluir</Button> : <span />}
            <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
          </div>
        </form>}
      </Modal>
      <Modal aberto={!!perda} titulo="Por que perdemos este negócio?" onClose={() => setPerda(null)}>
        {perda && <form onSubmit={(e) => { e.preventDefault(); mover(perda.op, "perdido", perda.motivo); }} className="space-y-3">
          <Field label="Motivo"><Input required minLength={3} autoFocus value={perda.motivo} onChange={(e) => setPerda({ ...perda, motivo: e.target.value })} placeholder="Preço, prazo, desistiu…" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setPerda(null)}>Cancelar</Button><Button type="submit">Marcar como perdido</Button></div>
        </form>}
      </Modal>
    </>
  );
}
