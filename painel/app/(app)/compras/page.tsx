"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Send, Check, PackageCheck, Ban, Download, MessageCircle, Pencil, Undo2 } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, hojeISO, numOuNull, TIPOS_COMPRA, CAT_GASTO, UNIDADES, UFS, STATUS_COMPRA, CAT_FINANCEIRO, FORMAS_PAGAMENTO, baixarCsv, csvNum, linkWhats, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Checkbox, Confirmar, Aviso, Tabs } from "@/components/ui";

type Forn = { id: string; nome: string; documento: string | null; contato: string | null; telefone: string | null; email: string | null; endereco: string | null; cidade: string | null;
  uf: string | null; materiais_fornecidos: string | null; condicoes_pagamento: string | null; prazo_medio_dias: number | null; observacoes: string | null; ativo: boolean };
type PC = { id: string; numero: number; fornecedor_id: string | null; status: string; data_pedido: string | null; previsao_entrega: string | null; subtotal: number; frete: number; desconto: number;
  total: number; categoria_financeira: string; parcelas: number; primeiro_vencimento: string | null; forma_pagamento: string | null; conta_id: string | null; observacoes: string | null;
  motivo_cancelamento: string | null; aprovado_em: string | null; enviado_em: string | null; recebido_em: string | null; created_at: string; fornecedores?: { nome: string } | null };
type Item = { id: string; material_id: string | null; descricao: string; unidade: string; quantidade: number; preco_unitario: number; total: number; quantidade_recebida: number };
type Mat = { id: string; nome: string; cor: string | null; unidade: string; tipo_compra: string };
type Aba = "pedidos" | "fornecedores" | "precos" | "rapida";

export default function Compras() { return <Exige perm={["compras_gerenciar", "financeiro_ver"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const idUrl = useParam("id");
  const [aba, setAba] = useState<Aba>("pedidos");
  const [aberta, setAberta] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("abertas");
  useEffect(() => { if (idUrl) setAberta(idUrl); }, [idUrl]);
  const gerencia = app.pode("compras_gerenciar") && app.podeEscrever;
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [pcs, forns] = await Promise.all([
      q<PC[]>(sb().from("pedidos_compra").select("*,fornecedores(nome)").eq("empresa_id", app.empresa.id).order("numero", { ascending: false }).limit(2000)),
      q<Forn[]>(sb().from("fornecedores").select("*").eq("empresa_id", app.empresa.id).order("nome")),
    ]);
    return { pcs, forns };
  }, [app.empresa.id]);
  const lista = useMemo(() => (dados?.pcs || []).filter((p) => filtro === "todas" ? true : filtro === "abertas" ? !["recebido", "cancelado"].includes(p.status) : p.status === filtro), [dados, filtro]);
  const aguardando = (dados?.pcs || []).filter((p) => p.status === "solicitado").length;

  const nova = async () => {
    try {
      const [r] = await q<{ id: string }[]>(sb().from("pedidos_compra").insert({ empresa_id: app.empresa.id, fornecedor_id: dados?.forns.find((f) => f.ativo)?.id || null }).select("id"));
      recarregar(); setAberta(r.id);
    } catch (e) { erro(e); }
  };

  return (
    <>
      <PageHeader titulo="Compras e Fornecedores" sub="Solicitação → aprovação → pedido ao fornecedor → recebimento com conferência → estoque e contas a pagar"
        acoes={aba === "pedidos" && gerencia ? <Button onClick={nova}><Plus className="h-4 w-4" /> Nova compra</Button> : undefined} />
      <Tabs abas={[["pedidos", `Pedidos de compra${aguardando ? ` (${aguardando} p/ aprovar)` : ""}`], ["fornecedores", "Fornecedores"], ["precos", "Histórico de preços"], ["rapida", "Compra rápida"]]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && <>
        {aba === "pedidos" && <Card>
          <CardTitle right={<Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-56" aria-label="Filtrar">
            <option value="abertas">Em andamento</option><option value="todas">Todas</option>{Object.entries(STATUS_COMPRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>
            Pedidos de compra</CardTitle>
          {!lista.length ? <Empty texto={dados.forns.length ? "Nenhuma compra aqui" : "Cadastre um fornecedor e crie a primeira compra"} /> : (
            <Table head={["Nº", "Fornecedor", "Criada", "Previsão", "Situação", "Total"]}>
              {lista.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setAberta(p.id)}>
                  <Td className="font-medium">#{p.numero}</Td><Td>{p.fornecedores?.nome || <span className="text-slate-400">Sem fornecedor</span>}</Td>
                  <Td>{data(p.created_at)}</Td><Td>{data(p.previsao_entrega)}</Td>
                  <Td><Badge tom={tomStatus(p.status)}>{STATUS_COMPRA[p.status]}</Badge></Td><Td className="tnum font-medium">{brl(p.total)}</Td>
                </tr>))}
            </Table>)}
        </Card>}
        {aba === "fornecedores" && <Fornecedores forns={dados.forns} pode={gerencia} onMudou={recarregar} />}
        {aba === "precos" && <Precos />}
        {aba === "rapida" && <CompraRapida />}
      </>}
      {aberta && dados && <DetalheCompra id={aberta} forns={dados.forns} onClose={() => { setAberta(null); if (idUrl) history.replaceState(null, "", "/compras/"); }} onMudou={recarregar} />}
    </>
  );
}

// ---------------------------------------------------------------- detalhe
function DetalheCompra({ id, forns, onClose, onMudou }: { id: string; forns: Forn[]; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const gerencia = app.pode("compras_gerenciar") && app.podeEscrever;
  const aprova = app.podeEscrever && (["dono", "admin"].includes(app.papel) || app.pode("financeiro_ver"));
  const verFin = app.pode("financeiro_ver");
  const [cab, setCab] = useState<PC | null>(null);
  const [novoItem, setNovoItem] = useState({ material: "", descricao: "", quantidade: "", preco: "" });
  const [receber, setReceber] = useState<{ qtd: Record<string, string>; nota: string; data: string; obs: string; div: string } | null>(null);
  const [motivo, setMotivo] = useState<{ acao: "cancelar" | "encerrar"; texto: string } | null>(null);
  const [excluir, setExcluir] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const { dados, erro: falha, recarregar } = useDados(async () => {
    const [[pc], itens, recs, mats, lancs, contas] = await Promise.all([
      q<PC[]>(sb().from("pedidos_compra").select("*,fornecedores(nome)").eq("id", id)),
      q<Item[]>(sb().from("pedido_compra_itens").select("*").eq("pedido_compra_id", id).order("ordem").order("created_at")),
      q<{ id: string; data: string; nota_fiscal: string | null; divergencia: string | null; observacao: string | null; itens: { descricao: string; quantidade: number; custo_unitario: number }[]; created_at: string }[]>(
        sb().from("compra_recebimentos").select("*").eq("pedido_compra_id", id).order("created_at")),
      q<Mat[]>(sb().from("materiais").select("id,nome,cor,unidade,tipo_compra").eq("empresa_id", app.empresa.id).eq("ativo", true).order("nome")),
      verFin ? q<{ id: string; descricao: string; valor: number; vencimento: string; pago: boolean; cancelado: boolean }[]>(sb().from("lancamentos").select("id,descricao,valor,vencimento,pago,cancelado").eq("compra_id", id).order("vencimento")) : Promise.resolve([]),
      verFin ? q<{ id: string; nome: string }[]>(sb().from("contas_financeiras").select("id,nome").eq("empresa_id", app.empresa.id).eq("ativa", true)) : Promise.resolve([]),
    ]);
    if (!pc) throw new Error("Compra não encontrada");
    return { pc, itens, recs, mats, lancs, contas };
  }, [id]);
  useEffect(() => { if (dados) setCab(dados.pc); }, [dados]);
  const pc = dados?.pc;
  const editavel = gerencia && !!pc && pc.status === "rascunho";
  const forn = forns.find((f) => f.id === pc?.fornecedor_id);
  const mudou = () => { recarregar(); onMudou(); };
  const acao = async (fn: () => Promise<unknown>, msg: string) => { setOcupado(true); try { await fn(); toast(msg); mudou(); } catch (e) { erro(e); } finally { setOcupado(false); } };
  const status = (s: string, m?: string) => acao(() => rpc("compra_mudar_status", { p_id: id, p_status: s, p_motivo: m || null }), `Compra: ${STATUS_COMPRA[s].toLowerCase()}`);

  const salvarCab = () => cab && acao(() => q(sb().from("pedidos_compra").update(pc && pc.status !== "rascunho"
    ? { previsao_entrega: cab.previsao_entrega || null, observacoes: cab.observacoes || null }
    : { fornecedor_id: cab.fornecedor_id || null, previsao_entrega: cab.previsao_entrega || null, frete: cab.frete || 0, desconto: cab.desconto || 0, categoria_financeira: cab.categoria_financeira,
        parcelas: cab.parcelas || 1, primeiro_vencimento: cab.primeiro_vencimento || null, forma_pagamento: cab.forma_pagamento || null, conta_id: cab.conta_id || null, observacoes: cab.observacoes || null }).eq("id", id)), "Compra salva");

  const addItem = (e: React.FormEvent) => {
    e.preventDefault();
    const m = dados?.mats.find((x) => x.id === novoItem.material);
    acao(async () => {
      await q(sb().from("pedido_compra_itens").insert({ empresa_id: app.empresa.id, pedido_compra_id: id, material_id: m?.id || null, descricao: novoItem.descricao || (m ? `${m.nome}${m.cor ? ` ${m.cor}` : ""}` : ""),
        quantidade: numOuNull(novoItem.quantidade), preco_unitario: numOuNull(novoItem.preco) || 0, ordem: (dados?.itens.length || 0) + 1 }));
      setNovoItem({ material: "", descricao: "", quantidade: "", preco: "" });
    }, "Item adicionado");
  };

  const msgWhats = pc && dados ? `Olá${forn?.contato ? ` ${forn.contato}` : ""}! Pedido de compra #${pc.numero} da ${app.empresa.nome}:\n` +
    dados.itens.map((i) => `• ${num(i.quantidade)} ${i.unidade} de ${i.descricao}${i.preco_unitario ? ` (${brl(i.preco_unitario)}/${i.unidade})` : ""}`).join("\n") +
    (pc.previsao_entrega ? `\nPrevisão: ${data(pc.previsao_entrega)}` : "") + `\nTotal: ${brl(pc.total)}` : "";

  return (
    <Modal aberto titulo={pc ? `Compra #${pc.numero}` : "Compra"} onClose={onClose} largura="max-w-5xl">
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : !dados || !pc || !cab ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={tomStatus(pc.status)}>{STATUS_COMPRA[pc.status]}</Badge>
            {pc.aprovado_em && <span className="text-xs text-slate-500">Aprovada {dataHora(pc.aprovado_em)}</span>}
            {pc.enviado_em && <span className="text-xs text-slate-500">· pedida {dataHora(pc.enviado_em)}</span>}
            {pc.recebido_em && <span className="text-xs text-slate-500">· recebida {dataHora(pc.recebido_em)}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              {gerencia && pc.status === "rascunho" && <Button size="sm" variant="secondary" loading={ocupado} onClick={() => status("solicitado")}><Send className="h-4 w-4" /> Pedir aprovação</Button>}
              {gerencia && pc.status === "solicitado" && <Button size="sm" variant="ghost" loading={ocupado} onClick={() => status("rascunho")}><Undo2 className="h-4 w-4" /> Voltar a rascunho</Button>}
              {aprova && ["rascunho", "solicitado"].includes(pc.status) && <Button size="sm" loading={ocupado} onClick={() => status("aprovado")}><Check className="h-4 w-4" /> Aprovar</Button>}
              {gerencia && pc.status === "aprovado" && <Button size="sm" loading={ocupado} onClick={() => status("enviado")}><Send className="h-4 w-4" /> Marcar como pedido ao fornecedor</Button>}
              {gerencia && ["enviado", "parcial"].includes(pc.status) && <Button size="sm" onClick={() => setReceber({ qtd: Object.fromEntries(dados.itens.map((i) => [i.id, String(Math.max(i.quantidade - i.quantidade_recebida, 0)).replace(".", ",")])), nota: "", data: hojeISO(), obs: "", div: "" })}><PackageCheck className="h-4 w-4" /> Receber</Button>}
              {gerencia && pc.status === "parcial" && <Button size="sm" variant="secondary" onClick={() => setMotivo({ acao: "encerrar", texto: "" })}>Encerrar sem o restante</Button>}
              {gerencia && ["rascunho", "solicitado", "aprovado", "enviado"].includes(pc.status) && <Button size="sm" variant="ghost" onClick={() => setMotivo({ acao: "cancelar", texto: "" })}><Ban className="h-4 w-4" /> Cancelar</Button>}
              {gerencia && ["rascunho", "cancelado"].includes(pc.status) && <Button size="sm" variant="ghost" onClick={() => setExcluir(true)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
          {pc.status === "solicitado" && <Aviso tom="amarelo">{aprova ? "Confira itens e valores e aprove." : "Aguardando aprovação da administração ou do financeiro."} Para mudar itens ou valores, volte para rascunho.</Aviso>}
          {pc.status === "aprovado" && forn?.telefone && dados.itens.length > 0 && (
            <Aviso>Envie o pedido ao fornecedor e depois clique em <b>Marcar como pedido ao fornecedor</b> (isso gera as contas a pagar).{" "}
              <a className="inline-flex items-center gap-1 font-medium underline" target="_blank" rel="noreferrer" href={linkWhats(forn.telefone, msgWhats) || "#"}><MessageCircle className="h-3.5 w-3.5" /> Mandar pelo WhatsApp</a></Aviso>)}
          {pc.motivo_cancelamento && <Aviso tom="vermelho">Cancelada: {pc.motivo_cancelamento}</Aviso>}

          <fieldset disabled={!gerencia || ["recebido", "cancelado"].includes(pc.status)}>
            <Grid cols={4}>
              <Field label="Fornecedor"><Select value={cab.fornecedor_id || ""} disabled={!editavel} onChange={(e) => setCab({ ...cab, fornecedor_id: e.target.value || null })}>
                <option value="">—</option>{forns.filter((f) => f.ativo || f.id === cab.fornecedor_id).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</Select></Field>
              <Field label="Previsão de entrega"><Input type="date" value={cab.previsao_entrega || ""} onChange={(e) => setCab({ ...cab, previsao_entrega: e.target.value })} /></Field>
              <Field label="Frete (R$)"><Input inputMode="decimal" disabled={!editavel} value={String(cab.frete ?? "").replace(".", ",")} onChange={(e) => setCab({ ...cab, frete: numOuNull(e.target.value) || 0 })} /></Field>
              <Field label="Desconto (R$)"><Input inputMode="decimal" disabled={!editavel} value={String(cab.desconto ?? "").replace(".", ",")} onChange={(e) => setCab({ ...cab, desconto: numOuNull(e.target.value) || 0 })} /></Field>
              <Field label="Categoria no financeiro"><Select value={cab.categoria_financeira} disabled={!editavel} onChange={(e) => setCab({ ...cab, categoria_financeira: e.target.value })}>
                {Object.entries(CAT_FINANCEIRO).filter(([k]) => !["vendas", "servicos"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Parcelas"><Select value={cab.parcelas} disabled={!editavel} onChange={(e) => setCab({ ...cab, parcelas: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 10, 12].map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x`}</option>)}</Select></Field>
              <Field label="1º vencimento" hint={forn?.prazo_medio_dias != null ? `Vazio = pedido + ${forn.prazo_medio_dias} dias` : "Vazio = pedido + 30 dias"}>
                <Input type="date" disabled={!editavel} value={cab.primeiro_vencimento || ""} onChange={(e) => setCab({ ...cab, primeiro_vencimento: e.target.value })} /></Field>
              <Field label="Forma de pagamento"><Select value={cab.forma_pagamento || ""} disabled={!editavel} onChange={(e) => setCab({ ...cab, forma_pagamento: e.target.value || null })}><option value="">—</option>{FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}</Select></Field>
              {verFin && <Field label="Conta"><Select value={cab.conta_id || ""} disabled={!editavel} onChange={(e) => setCab({ ...cab, conta_id: e.target.value || null })}><option value="">—</option>{dados.contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>}
            </Grid>
            <div className="mt-3"><Field label="Observações"><Textarea value={cab.observacoes || ""} onChange={(e) => setCab({ ...cab, observacoes: e.target.value })} /></Field></div>
            {gerencia && !["recebido", "cancelado"].includes(pc.status) && <div className="mt-3 flex justify-end"><Button size="sm" variant="secondary" loading={ocupado} onClick={salvarCab}>Salvar dados</Button></div>}
          </fieldset>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Itens</h3>
            {!dados.itens.length ? <Empty texto="Nenhum item ainda" /> : (
              <Table head={["Item", "Qtd.", "Preço unit.", "Total", "Recebido", ""]}>
                {dados.itens.map((i) => (
                  <tr key={i.id}><Td>{i.descricao}{!i.material_id && <span className="ml-1 text-xs text-slate-400">(não entra no estoque)</span>}</Td>
                    <Td className="tnum">{num(i.quantidade)} {i.unidade}</Td><Td className="tnum">{brl(i.preco_unitario)}</Td><Td className="tnum">{brl(i.total)}</Td>
                    <Td className={cn("tnum", i.quantidade_recebida >= i.quantidade ? "text-emerald-600" : i.quantidade_recebida > 0 ? "text-amber-600" : "text-slate-400")}>{num(i.quantidade_recebida)} {i.unidade}</Td>
                    <Td>{editavel && <button aria-label="Remover item" className="text-slate-400 hover:text-red-600" onClick={() => acao(() => q(sb().from("pedido_compra_itens").delete().eq("id", i.id)), "Item removido")}><Trash2 className="h-4 w-4" /></button>}</Td></tr>))}
              </Table>)}
            {editavel && <form onSubmit={addItem} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1.4fr_1.4fr_.7fr_.8fr_auto] dark:bg-slate-800/50">
              <Select value={novoItem.material} onChange={(e) => setNovoItem({ ...novoItem, material: e.target.value })} aria-label="Matéria-prima">
                <option value="">Item avulso (sem estoque)</option>{dados.mats.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.cor ? ` · ${m.cor}` : ""} ({m.unidade})</option>)}</Select>
              <Input placeholder={novoItem.material ? "Descrição (opcional)" : "Descrição do item"} required={!novoItem.material} value={novoItem.descricao} onChange={(e) => setNovoItem({ ...novoItem, descricao: e.target.value })} />
              <Input placeholder={`Qtd.${novoItem.material ? ` (${dados.mats.find((m) => m.id === novoItem.material)?.unidade})` : ""}`} required inputMode="decimal" value={novoItem.quantidade} onChange={(e) => setNovoItem({ ...novoItem, quantidade: e.target.value })} />
              <Input placeholder="R$ unit." inputMode="decimal" value={novoItem.preco} onChange={(e) => setNovoItem({ ...novoItem, preco: e.target.value })} />
              <Button type="submit" loading={ocupado}><Plus className="h-4 w-4" /></Button>
            </form>}
            <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
              <span>Itens: <b className="tnum">{brl(pc.subtotal)}</b></span><span>Frete: <b className="tnum">{brl(pc.frete)}</b></span>
              <span>Desconto: <b className="tnum">− {brl(pc.desconto)}</b></span><span className="text-base">Total: <b className="tnum">{brl(pc.total)}</b></span>
            </div>
            {pc.frete - pc.desconto !== 0 && pc.subtotal > 0 && <p className="mt-1 text-right text-xs text-slate-500">Frete e desconto são rateados no custo de entrada dos materiais.</p>}
          </div>

          {verFin && dados.lancs.length > 0 && <div>
            <h3 className="mb-2 text-sm font-semibold">Contas a pagar</h3>
            <Table head={["Vencimento", "Descrição", "Valor", "Situação"]}>{dados.lancs.map((l) => (
              <tr key={l.id}><Td>{data(l.vencimento)}</Td><Td>{l.descricao}</Td><Td className="tnum">{brl(l.valor)}</Td>
                <Td>{l.cancelado ? <Badge>Cancelada</Badge> : l.pago ? <Badge tom="verde">Paga</Badge> : <Badge tom="amarelo">Em aberto</Badge>}</Td></tr>))}</Table>
            <p className="mt-1 text-xs text-slate-500">Pague as parcelas em Financeiro → Contas a pagar.</p>
          </div>}

          {dados.recs.length > 0 && <div>
            <h3 className="mb-2 text-sm font-semibold">Recebimentos e conferência</h3>
            <div className="space-y-2">{dados.recs.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <div className="flex flex-wrap gap-x-4 text-slate-500"><span>{data(r.data)}</span>{r.nota_fiscal && <span>NF {r.nota_fiscal}</span>}<span>registrado {dataHora(r.created_at)}</span></div>
                <ul className="mt-1">{r.itens.map((i, k) => <li key={k}>{num(i.quantidade)} × {i.descricao} <span className="text-slate-500">· custo de entrada {brl(i.custo_unitario)}</span></li>)}</ul>
                {r.divergencia && <div className="mt-1 text-amber-700">Divergência: {r.divergencia}</div>}
                {r.observacao && <div className="mt-1 text-slate-500">{r.observacao}</div>}
              </div>))}</div>
          </div>}

          <Modal aberto={!!receber} titulo="Receber e conferir" onClose={() => setReceber(null)} largura="max-w-2xl">
            {receber && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); acao(async () => {
              const r = await rpc<string>("receber_compra", { p_id: id, p_itens: Object.entries(receber.qtd).map(([item_id, v]) => ({ item_id, quantidade: numOuNull(v) || 0 })),
                p_data: receber.data, p_nota: receber.nota || null, p_obs: receber.obs || null, p_divergencia: receber.div || null });
              setReceber(null); if (r === "parcial") toast("Ficou parte pendente: receba o resto quando chegar");
            }, "Recebimento registrado e estoque atualizado"); }}>
              <p className="text-sm text-slate-500">Confira as quantidades que chegaram. Itens com matéria-prima entram no estoque com o custo da compra.</p>
              <Table head={["Item", "Pendente", "Chegou"]}>{dados.itens.map((i) => (
                <tr key={i.id}><Td>{i.descricao}</Td><Td className="tnum">{num(i.quantidade - i.quantidade_recebida)} {i.unidade}</Td>
                  <Td><Input inputMode="decimal" className="w-28" value={receber.qtd[i.id] || ""} disabled={i.quantidade_recebida >= i.quantidade} onChange={(e) => setReceber({ ...receber, qtd: { ...receber.qtd, [i.id]: e.target.value } })} /></Td></tr>))}</Table>
              <Grid><Field label="Data"><Input type="date" value={receber.data} onChange={(e) => setReceber({ ...receber, data: e.target.value })} /></Field>
                <Field label="Nota fiscal"><Input value={receber.nota} onChange={(e) => setReceber({ ...receber, nota: e.target.value })} /></Field></Grid>
              <Field label="Divergências" hint="Faltou, veio errado, avariado…"><Textarea value={receber.div} onChange={(e) => setReceber({ ...receber, div: e.target.value })} /></Field>
              <Field label="Observação"><Input value={receber.obs} onChange={(e) => setReceber({ ...receber, obs: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setReceber(null)}>Voltar</Button><Button type="submit" loading={ocupado}>Confirmar recebimento</Button></div>
            </form>}
          </Modal>
          <Confirmar aberto={!!motivo} titulo={motivo?.acao === "cancelar" ? "Cancelar compra" : "Encerrar compra"} perigo={motivo?.acao === "cancelar"} carregando={ocupado}
            confirmar={motivo?.acao === "cancelar" ? "Cancelar compra" : "Encerrar"} onCancel={() => setMotivo(null)}
            texto={motivo?.acao === "cancelar" ? "As contas a pagar em aberto desta compra também são canceladas." : "O que faltou não será mais esperado. As parcelas em aberto são reduzidas para o valor do que chegou."}
            onOk={() => motivo && (motivo.acao === "cancelar" ? status("cancelado", motivo.texto) : acao(async () => { const d = await rpc<number>("encerrar_compra", { p_id: id, p_motivo: motivo.texto }); if (d > 0) toast(`Já foi pago ${brl(d)} a mais: combine o crédito com o fornecedor`, "erro"); }, "Compra encerrada e parcelas ajustadas")).then(() => setMotivo(null))}>
            {motivo && <div className="mt-3"><Field label="Motivo"><Input autoFocus value={motivo.texto} onChange={(e) => setMotivo({ ...motivo, texto: e.target.value })} /></Field></div>}
          </Confirmar>
          <Confirmar aberto={excluir} titulo="Excluir compra" perigo confirmar="Excluir" onCancel={() => setExcluir(false)} texto="A compra e seus itens serão apagados."
            onOk={async () => { try { await q(sb().from("pedidos_compra").delete().eq("id", id)); toast("Compra excluída"); onMudou(); onClose(); } catch (e) { erro(e); } }} />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- fornecedores
const fornVazio = (): Partial<Forn> => ({ nome: "", ativo: true });
function Fornecedores({ forns, pode, onMudou }: { forns: Forn[]; pode: boolean; onMudou: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Partial<Forn> | null>(null);
  const [busca, setBusca] = useState("");
  const lista = forns.filter((x) => !busca || `${x.nome} ${x.materiais_fornecidos || ""} ${x.cidade || ""}`.toLowerCase().includes(busca.toLowerCase()));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!f) return;
    const v = { nome: f.nome, documento: f.documento || null, contato: f.contato || null, telefone: f.telefone || null, email: f.email || null, endereco: f.endereco || null, cidade: f.cidade || null,
      uf: f.uf || null, materiais_fornecidos: f.materiais_fornecidos || null, condicoes_pagamento: f.condicoes_pagamento || null, prazo_medio_dias: f.prazo_medio_dias ?? null, observacoes: f.observacoes || null, ativo: f.ativo ?? true };
    try {
      if (f.id) await q(sb().from("fornecedores").update(v).eq("id", f.id)); else await q(sb().from("fornecedores").insert({ ...v, empresa_id: app.empresa.id }));
      toast("Fornecedor salvo"); setF(null); onMudou();
    } catch (e2) { erro(e2); }
  };
  return (
    <Card>
      <CardTitle right={<div className="flex gap-2"><Input placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} className="w-48" />
        {pode && <Button size="sm" onClick={() => setF(fornVazio())}><Plus className="h-4 w-4" /> Novo fornecedor</Button>}</div>}>Fornecedores</CardTitle>
      {!lista.length ? <Empty texto="Nenhum fornecedor" /> : (
        <Table head={["Nome", "Contato", "Fornece", "Prazo médio", "Condições", ""]}>
          {lista.map((x) => (
            <tr key={x.id} className={x.ativo ? "" : "opacity-50"}>
              <Td><div className="font-medium">{x.nome}</div><div className="text-xs text-slate-500">{[x.documento, x.cidade && `${x.cidade}${x.uf ? `/${x.uf}` : ""}`].filter(Boolean).join(" · ")}</div></Td>
              <Td><div>{x.contato || "—"}</div><div className="text-xs text-slate-500">{[x.telefone, x.email].filter(Boolean).join(" · ")}</div></Td>
              <Td className="max-w-xs truncate">{x.materiais_fornecidos || "—"}</Td><Td>{x.prazo_medio_dias != null ? `${x.prazo_medio_dias} dias` : "—"}</Td><Td>{x.condicoes_pagamento || "—"}</Td>
              <Td><div className="flex justify-end gap-1">
                {x.telefone && <a href={linkWhats(x.telefone) || "#"} target="_blank" rel="noreferrer" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="WhatsApp"><MessageCircle className="h-4 w-4" /></a>}
                {pode && <button onClick={() => setF(x)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>}</div></Td>
            </tr>))}
        </Table>)}
      <Modal aberto={!!f} titulo={f?.id ? "Editar fornecedor" : "Novo fornecedor"} onClose={() => setF(null)} largura="max-w-2xl">
        {f && <form className="space-y-3" onSubmit={salvar}>
          <Grid>
            <Field label="Nome"><Input required value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
            <Field label="CNPJ / CPF"><Input value={f.documento || ""} onChange={(e) => setF({ ...f, documento: e.target.value })} /></Field>
            <Field label="Contato"><Input value={f.contato || ""} onChange={(e) => setF({ ...f, contato: e.target.value })} /></Field>
            <Field label="Telefone / WhatsApp"><Input value={f.telefone || ""} onChange={(e) => setF({ ...f, telefone: e.target.value })} /></Field>
            <Field label="E-mail"><Input type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Endereço"><Input value={f.endereco || ""} onChange={(e) => setF({ ...f, endereco: e.target.value })} /></Field>
            <Field label="Cidade"><Input value={f.cidade || ""} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></Field>
            <Field label="UF"><Select value={f.uf || ""} onChange={(e) => setF({ ...f, uf: e.target.value || null })}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="Condições de pagamento"><Input value={f.condicoes_pagamento || ""} onChange={(e) => setF({ ...f, condicoes_pagamento: e.target.value })} placeholder="30/60 dias, Pix à vista…" /></Field>
            <Field label="Prazo médio de entrega (dias)"><Input inputMode="numeric" value={f.prazo_medio_dias ?? ""} onChange={(e) => setF({ ...f, prazo_medio_dias: numOuNull(e.target.value) })} /></Field>
          </Grid>
          <Field label="Materiais fornecidos"><Input value={f.materiais_fornecidos || ""} onChange={(e) => setF({ ...f, materiais_fornecidos: e.target.value })} placeholder="PLA, PETG, resina…" /></Field>
          <Field label="Observações"><Textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Field>
          <Checkbox label="Ativo" checked={f.ativo ?? true} onChange={(v) => setF({ ...f, ativo: v })} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setF(null)}>Cancelar</Button><Button type="submit">Salvar</Button></div>
        </form>}
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- histórico de preços
function Precos() {
  const app = useApp();
  const [mat, setMat] = useState("");
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<{ id: string; material_id: string; descricao: string; unidade: string; quantidade: number; preco_unitario: number;
    pedidos_compra: { numero: number; status: string; data_pedido: string | null; created_at: string; fornecedores: { nome: string } | null } }[]>(
    sb().from("pedido_compra_itens").select("id,material_id,descricao,unidade,quantidade,preco_unitario,pedidos_compra!inner(numero,status,data_pedido,created_at,fornecedores(nome))")
      .eq("empresa_id", app.empresa.id).not("material_id", "is", null).not("pedidos_compra.status", "in", "(rascunho,cancelado)").limit(5000)), [app.empresa.id]);
  const linhas = useMemo(() => (dados || []).filter((i) => !mat || i.material_id === mat)
    .map((i) => ({ ...i, quando: i.pedidos_compra.data_pedido || i.pedidos_compra.created_at.slice(0, 10) })).sort((a, b) => b.quando.localeCompare(a.quando)), [dados, mat]);
  const materiais = useMemo(() => Array.from(new Map((dados || []).map((i) => [i.material_id, i.descricao])).entries()), [dados]);
  const resumo = useMemo(() => {
    if (!mat || !linhas.length) return null;
    const p = linhas.map((l) => l.preco_unitario);
    return { ultimo: p[0], min: Math.min(...p), max: Math.max(...p), medio: p.reduce((s, x) => s + x, 0) / p.length, un: linhas[0].unidade };
  }, [linhas, mat]);
  return (
    <Card>
      <CardTitle right={<div className="flex gap-2">
        <Select value={mat} onChange={(e) => setMat(e.target.value)} className="w-64" aria-label="Material"><option value="">Todos os materiais</option>{materiais.map(([id, d]) => <option key={id} value={id}>{d}</option>)}</Select>
        <Button size="sm" variant="secondary" onClick={() => baixarCsv("historico-precos", [["Data", "Compra", "Fornecedor", "Item", "Quantidade", "Unidade", "Preço unitário"],
          ...linhas.map((l) => [l.quando, l.pedidos_compra.numero, l.pedidos_compra.fornecedores?.nome, l.descricao, csvNum(l.quantidade), l.unidade, csvNum(l.preco_unitario)])])}><Download className="h-4 w-4" /> CSV</Button></div>}>
        Histórico de preços</CardTitle>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !linhas.length ? <Empty texto="Os preços aparecem aqui depois das primeiras compras aprovadas" /> : <>
        {resumo && <div className="mb-4 flex flex-wrap gap-6 text-sm"><span>Último: <b>{brl(resumo.ultimo)}/{resumo.un}</b></span><span>Médio: <b>{brl(resumo.medio)}</b></span>
          <span>Menor: <b className="text-emerald-600">{brl(resumo.min)}</b></span><span>Maior: <b className="text-red-600">{brl(resumo.max)}</b></span></div>}
        <Table head={["Data", "Compra", "Fornecedor", "Item", "Qtd.", "Preço unit."]}>{linhas.map((l) => (
          <tr key={l.id}><Td>{data(l.quando)}</Td><Td>#{l.pedidos_compra.numero}</Td><Td>{l.pedidos_compra.fornecedores?.nome || "—"}</Td><Td>{l.descricao}</Td>
            <Td className="tnum">{num(l.quantidade)} {l.unidade}</Td><Td className="tnum font-medium">{brl(l.preco_unitario)}</Td></tr>))}</Table>
      </>}
    </Card>
  );
}

// ---------------------------------------------------------------- compra rápida (balcão)
type Gasto = { id: string; descricao: string; categoria: string; valor: number; data: string; material_id: string | null };
const vazio = () => ({ tipo: "filamento", nome: "", detalhe: "", quantidade: "", unidade: "kg", valor: "", data: hojeISO(), minimo: "", lancar: true });
function CompraRapida() {
  const app = useApp();
  const [f, setF] = useState(vazio());
  const [salvando, setSalvando] = useState(false);
  const [mes, setMes] = useState(hojeISO().slice(0, 7));
  const [excluir, setExcluir] = useState<Gasto | null>(null);
  const registra = app.pode("compras_gerenciar") && app.podeEscrever;
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [itens, gastos] = await Promise.all([
      q<{ nome: string; cor: string | null; unidade: string; tipo_compra: string }[]>(sb().from("materiais").select("nome,cor,unidade,tipo_compra").eq("empresa_id", app.empresa.id).eq("ativo", true).order("nome")),
      q<Gasto[]>(sb().from("gastos").select("id,descricao,categoria,valor,data,material_id").eq("empresa_id", app.empresa.id)
        .gte("data", `${mes}-01`).lt("data", new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 1).toISOString().slice(0, 10)).order("data", { ascending: false })),
    ]);
    return { itens, gastos };
  }, [app.empresa.id, mes]);
  const registrar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const r = await rpc<{ saldo: number }>("registrar_compra", { p_empresa: app.empresa.id, p_tipo: f.tipo, p_nome: f.nome, p_quantidade: numOuNull(f.quantidade), p_valor_total: numOuNull(f.valor) ?? 0,
        p_unidade: f.unidade, p_detalhe: f.detalhe || null, p_data: f.data, p_estoque_minimo: numOuNull(f.minimo), p_lancar_gasto: f.lancar });
      toast(`Compra registrada. Saldo de ${f.nome}: ${r.saldo} ${f.unidade}`); setF({ ...vazio(), tipo: f.tipo, unidade: f.unidade }); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const sugestoes = (dados?.itens || []).filter((i) => i.tipo_compra === f.tipo);
  const total = (dados?.gastos || []).reduce((s, g) => s + Number(g.valor), 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardTitle>Compra rápida (já paga, sem pedido)</CardTitle>
        <form onSubmit={registrar} className="space-y-3">
          <fieldset disabled={!registra} className="space-y-3">
            <Field label="Tipo de compra"><Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>{Object.entries(TIPOS_COMPRA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Item" hint="Se já existir com o mesmo nome e detalhe, soma no estoque"><Input required list="itens-compra" value={f.nome} onChange={(e) => {
              const it = sugestoes.find((i) => i.nome === e.target.value); setF({ ...f, nome: e.target.value, ...(it ? { detalhe: it.cor || "", unidade: it.unidade } : {}) }); }} /></Field>
            <datalist id="itens-compra">{sugestoes.map((i, k) => <option key={k} value={i.nome}>{i.cor}</option>)}</datalist>
            <Field label="Cor / detalhe"><Input value={f.detalhe} onChange={(e) => setF({ ...f, detalhe: e.target.value })} /></Field>
            <Grid>
              <Field label="Quantidade"><Input required inputMode="decimal" value={f.quantidade} onChange={(e) => setF({ ...f, quantidade: e.target.value })} /></Field>
              <Field label="Unidade"><Select value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</Select></Field>
              <Field label="Valor total pago (R$)"><Input required inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></Field>
              <Field label="Data"><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
            </Grid>
            <Field label="Estoque mínimo (opcional)"><Input inputMode="decimal" value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} /></Field>
            <Checkbox label="Lançar o valor em Gastos" checked={f.lancar} onChange={(v) => setF({ ...f, lancar: v })} />
            <Button type="submit" loading={salvando} className="w-full"><Plus className="h-4 w-4" /> Registrar compra</Button>
          </fieldset>
        </form>
      </Card>
      <Card>
        <CardTitle right={<Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-40" aria-label="Mês" />}>Gastos do mês</CardTitle>
        {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !dados?.gastos.length ? <Empty texto="Nenhum gasto neste mês" /> : (<>
          <Table head={["Data", "Descrição", "Categoria", "Valor", ""]}>{dados.gastos.map((g) => (
            <tr key={g.id}><Td>{data(g.data)}</Td><Td>{g.descricao}</Td><Td><Badge>{CAT_GASTO[g.categoria]}</Badge></Td><Td className="tnum">{brl(g.valor)}</Td>
              <Td>{registra && <button onClick={() => setExcluir(g)} className="text-slate-400 hover:text-red-600" aria-label="Excluir gasto"><Trash2 className="h-4 w-4" /></button>}</Td></tr>))}</Table>
          <div className="mt-3 text-right text-sm font-semibold">Total: {brl(total)}</div></>)}
        <p className="mt-4 text-xs text-slate-500">Para compras com fornecedor, aprovação e prazo, use Pedidos de compra: elas geram as contas a pagar no Financeiro.</p>
      </Card>
      <Confirmar aberto={!!excluir} titulo="Excluir gasto" perigo confirmar="Excluir" onCancel={() => setExcluir(null)}
        onOk={async () => { try { await q(sb().from("gastos").delete().eq("id", excluir!.id)); toast("Gasto excluído"); setExcluir(null); recarregar(); } catch (e) { erro(e); } }}
        texto="Excluir o gasto não mexe no estoque. Se a compra foi lançada errada, estorne também a entrada em Matéria-prima → Movimentações." />
    </div>
  );
}
