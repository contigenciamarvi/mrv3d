"use client";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "@/lib/supabase";
import { erroMsg, hojeISO, numOuNull, num, CAT_GASTO, TIPOS_SERVICO, cn } from "@/lib/utils";
import { Button, Field, Input, Select, Textarea, Loading, ErrorBox, Aviso, Grid } from "@/components/ui";

type Info = { empresa: string; link: string; permissoes: { pedidos: boolean; gastos: boolean; estoque: boolean };
  materiais: { id: string; nome: string; cor: string | null; unidade: string; quantidade: number; estoque_minimo: number }[]; clientes: { id: string; nome: string }[] };
type Aba = "pedidos" | "gastos" | "estoque";

/** Página pública dos links de acesso (sem login): /l/TOKEN */
export default function LinkAcesso() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [falha, setFalha] = useState("");
  const [aba, setAba] = useState<Aba>("pedidos");
  const [ok, setOk] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ped, setPed] = useState({ modo: "existente", cliente_id: "", cliente_nome: "", cliente_tel: "", tipo: "impressao_3d", descricao: "", total: "", pago: "", entrega: "" });
  const [gas, setGas] = useState({ descricao: "", valor: "", categoria: "material", data: hojeISO(), material_id: "" });
  const [mov, setMov] = useState({ tipo: "saida", material_id: "", quantidade: "", obs: "" });

  const carregar = useCallback(async (t: string) => {
    try {
      const d = await rpc<Info>("link_info", { p_token: t }); setInfo(d);
      setAba(d.permissoes.pedidos ? "pedidos" : d.permissoes.gastos ? "gastos" : "estoque");
    } catch (e) { setFalha(erroMsg(e)); }
  }, []);
  useEffect(() => {
    const t = location.pathname.split("/").filter(Boolean)[1] || new URLSearchParams(location.search).get("t") || "";
    setToken(t); if (t) carregar(t); else setFalha("Link incompleto");
  }, [carregar]);

  const enviar = async (fn: () => Promise<string>) => {
    setEnviando(true); setOk(""); setFalha("");
    try { setOk(await fn()); const d = await rpc<Info>("link_info", { p_token: token }); setInfo(d); }
    catch (e) { setFalha(erroMsg(e)); } finally { setEnviando(false); }
  };

  if (!info) return falha ? <div className="mx-auto max-w-md p-6"><ErrorBox erro={falha} /></div> : <Loading />;
  const abas = ([["pedidos", "Pedido"], ["gastos", "Gasto"], ["estoque", "Matéria-prima"]] as [Aba, string][]).filter(([k]) => info.permissoes[k]);
  const matSel = info.materiais.find((m) => m.id === mov.material_id);
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="bg-slate-900 px-4 py-4 text-white"><div className="mx-auto max-w-lg"><div className="text-lg font-semibold">{info.empresa}</div><div className="text-sm text-slate-400">Lançamentos · {info.link}</div></div></header>
      <main className="mx-auto max-w-lg space-y-4 p-4">
        <div className="grid gap-1 rounded-lg bg-white p-1 dark:bg-slate-900" style={{ gridTemplateColumns: `repeat(${abas.length}, 1fr)` }}>
          {abas.map(([k, l]) => <button key={k} onClick={() => { setAba(k); setOk(""); setFalha(""); }} className={cn("h-10 rounded-md text-sm font-medium", aba === k ? "bg-brand-600 text-white" : "text-slate-600")}>{l}</button>)}
        </div>
        {ok && <Aviso tom="verde">{ok}</Aviso>}
        {falha && <ErrorBox erro={falha} />}
        <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900">
          {aba === "pedidos" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(async () => {
            const r = await rpc<{ numero: number }>("link_registrar_pedido", { p_token: token, p_descricao: ped.descricao, p_valor_total: numOuNull(ped.total) ?? 0, p_valor_pago: numOuNull(ped.pago) ?? 0,
              p_tipo_servico: ped.tipo, p_data_entrega: ped.entrega || null, p_cliente_id: ped.modo === "existente" ? ped.cliente_id || null : null,
              p_cliente_nome: ped.modo === "novo" ? ped.cliente_nome || null : null, p_cliente_telefone: ped.modo === "novo" ? ped.cliente_tel || null : null });
            setPed({ ...ped, descricao: "", total: "", pago: "", entrega: "", cliente_nome: "", cliente_tel: "" }); return `Pedido #${r.numero} salvo!`; }); }}>
            <div className="flex gap-2 text-sm">{[["existente", "Cliente cadastrado"], ["novo", "Cliente novo"]].map(([k, l]) => <button type="button" key={k} onClick={() => setPed({ ...ped, modo: k })} className={cn("rounded-full px-3 py-1", ped.modo === k ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>{l}</button>)}</div>
            {ped.modo === "existente" ? <Field label="Cliente"><Select value={ped.cliente_id} onChange={(e) => setPed({ ...ped, cliente_id: e.target.value })}><option value="">Sem cliente</option>{info.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</Select></Field>
              : <Grid><Field label="Nome"><Input required value={ped.cliente_nome} onChange={(e) => setPed({ ...ped, cliente_nome: e.target.value })} /></Field><Field label="Telefone"><Input inputMode="tel" value={ped.cliente_tel} onChange={(e) => setPed({ ...ped, cliente_tel: e.target.value })} /></Field></Grid>}
            <Field label="Serviço"><Select value={ped.tipo} onChange={(e) => setPed({ ...ped, tipo: e.target.value })}>{Object.entries(TIPOS_SERVICO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Descrição"><Textarea required value={ped.descricao} onChange={(e) => setPed({ ...ped, descricao: e.target.value })} /></Field>
            <Grid><Field label="Valor total (R$)"><Input required inputMode="decimal" value={ped.total} onChange={(e) => setPed({ ...ped, total: e.target.value })} /></Field>
              <Field label="Já pago (R$)"><Input inputMode="decimal" value={ped.pago} onChange={(e) => setPed({ ...ped, pago: e.target.value })} /></Field></Grid>
            <Field label="Entrega"><Input type="date" value={ped.entrega} onChange={(e) => setPed({ ...ped, entrega: e.target.value })} /></Field>
            <Button type="submit" loading={enviando} className="w-full">Salvar pedido</Button>
          </form>}
          {aba === "gastos" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(async () => {
            await rpc("link_registrar_gasto", { p_token: token, p_descricao: gas.descricao, p_valor: numOuNull(gas.valor), p_categoria: gas.categoria, p_data: gas.data || hojeISO(), p_material_id: gas.material_id || null });
            setGas({ ...gas, descricao: "", valor: "", material_id: "" }); return "Gasto salvo!"; }); }}>
            <Field label="Descrição"><Input required value={gas.descricao} onChange={(e) => setGas({ ...gas, descricao: e.target.value })} /></Field>
            <Grid><Field label="Valor (R$)"><Input required inputMode="decimal" value={gas.valor} onChange={(e) => setGas({ ...gas, valor: e.target.value })} /></Field>
              <Field label="Data"><Input type="date" value={gas.data} onChange={(e) => setGas({ ...gas, data: e.target.value })} /></Field></Grid>
            <Field label="Categoria"><Select value={gas.categoria} onChange={(e) => setGas({ ...gas, categoria: e.target.value })}>{Object.entries(CAT_GASTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Button type="submit" loading={enviando} className="w-full">Salvar gasto</Button>
          </form>}
          {aba === "estoque" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(async () => {
            const s = await rpc<number>("link_movimentar_estoque", { p_token: token, p_material_id: mov.material_id, p_tipo: mov.tipo, p_quantidade: numOuNull(mov.quantidade), p_observacao: mov.obs || null });
            setMov({ ...mov, quantidade: "", obs: "" }); return `Registrado! Saldo agora: ${num(s)} ${matSel?.unidade || ""}`; }); }}>
            <div className="grid grid-cols-3 gap-1">{[["saida", "Usei"], ["entrada", "Comprei"], ["ajuste", "Contei"]].map(([k, l]) => <button type="button" key={k} onClick={() => setMov({ ...mov, tipo: k })} className={cn("h-9 rounded-md text-sm", mov.tipo === k ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800")}>{l}</button>)}</div>
            <Field label="Item"><Select required value={mov.material_id} onChange={(e) => setMov({ ...mov, material_id: e.target.value })}><option value="">Escolha…</option>
              {info.materiais.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.cor ? ` · ${m.cor}` : ""} ({num(m.quantidade)} {m.unidade})</option>)}</Select></Field>
            <Field label={mov.tipo === "saida" ? "Quantidade usada" : mov.tipo === "entrada" ? "Quantidade comprada" : "Saldo contado (novo total)"}><Input required inputMode="decimal" value={mov.quantidade} onChange={(e) => setMov({ ...mov, quantidade: e.target.value })} /></Field>
            <Field label={mov.tipo === "ajuste" ? "Motivo da contagem" : "Observação"}><Input required={mov.tipo === "ajuste"} value={mov.obs} onChange={(e) => setMov({ ...mov, obs: e.target.value })} /></Field>
            <Button type="submit" loading={enviando} className="w-full">Registrar</Button>
          </form>}
        </div>
      </main>
    </div>
  );
}
