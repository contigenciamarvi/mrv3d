"use client";
import { useEffect, useState } from "react";
import { Upload, Copy, MessageCircle, Trash2, Download, Plus } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, enviarArquivo, urlTemporaria } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, dataHora, numOuNull, UFS } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Table, Td, Empty, Badge, Tabs, Checkbox, Aviso, Confirmar } from "@/components/ui";

type Aba = "empresa" | "precificacao" | "preferencias" | "links" | "dados" | "seguranca";

export default function Configuracoes() { return <Exige perm="config_editar"><Conteudo /></Exige>; }

function Conteudo() {
  const [aba, setAba] = useState<Aba>("empresa");
  return (
    <>
      <PageHeader titulo="Configurações" />
      <Tabs abas={[["empresa", "Empresa e logo"], ["precificacao", "Precificação e impostos"], ["preferencias", "Preferências e mensagens"], ["links", "Links de acesso"], ["dados", "Backup e exportação"], ["seguranca", "Segurança"]]} ativa={aba} onChange={setAba} />
      {aba === "empresa" && <Empresa />}
      {(aba === "precificacao" || aba === "preferencias") && <ConfigForm aba={aba} />}
      {aba === "links" && <Links />}
      {aba === "dados" && <Exportar />}
      {aba === "seguranca" && <Seguranca />}
    </>
  );
}

function Empresa() {
  const app = useApp();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    q<Record<string, string | null>>(sb().from("empresas").select("nome,razao_social,documento,responsavel,email,telefone,whatsapp,endereco,cidade,uf,cep").eq("id", app.empresa.id).single())
      .then((e) => setF(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ""])))).catch(erro);
    if (app.config.logo_path) urlTemporaria(app.config.logo_path).then(setLogo).catch(() => {});
  }, [app.empresa.id, app.config.logo_path]);
  if (!f) return null;
  const campo = (k: string, l: string, p: Record<string, unknown> = {}) => <Field label={l}><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...p} /></Field>;
  return (
    <Card>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setSalvando(true); try { await q(sb().from("empresas").update(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || (k === "nome" ? f.nome : null)]))).eq("id", app.empresa.id)); toast("Dados salvos"); app.recarregar(); } catch (e2) { erro(e2); } finally { setSalvando(false); } }}>
        <fieldset disabled={!app.podeEscrever} className="space-y-3">
          <div className="flex items-center gap-4">
            {logo ? <img src={logo} alt="Logo" className="h-16 w-16 rounded-lg border border-slate-200 object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400 dark:bg-slate-800">sem logo</div>}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><Upload className="h-4 w-4" /> Trocar logotipo
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const a = e.target.files?.[0]; if (!a) return; try { const p = await enviarArquivo(app.empresa.id, "logo", a); await q(sb().from("empresa_config").update({ logo_path: p }).eq("empresa_id", app.empresa.id)); setLogo(await urlTemporaria(p)); toast("Logo atualizado"); app.recarregar(); } catch (e2) { erro(e2); } }} /></label>
          </div>
          <Grid cols={3}>
            {campo("nome", "Nome fantasia", { required: true })}{campo("razao_social", "Razão social")}{campo("documento", "CPF/CNPJ")}
            {campo("responsavel", "Responsável")}{campo("email", "E-mail", { type: "email" })}{campo("whatsapp", "WhatsApp")}
            {campo("telefone", "Telefone")}{campo("cep", "CEP")}{campo("cidade", "Cidade")}
          </Grid>
          {campo("endereco", "Endereço")}
          <Field label="Estado"><Select value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value })} className="w-32"><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
          <p className="text-xs text-slate-500">Estes dados aparecem nos orçamentos e servem como dados de cobrança da assinatura.</p>
          <div className="flex justify-end"><Button type="submit" loading={salvando}>Salvar</Button></div>
        </fieldset>
      </form>
    </Card>
  );
}

function ConfigForm({ aba }: { aba: "precificacao" | "preferencias" }) {
  const app = useApp();
  const c = app.config as unknown as Record<string, unknown>;
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v)])));
  const [salvando, setSalvando] = useState(false);
  const NUM = ["energia_kwh", "mao_obra_hora", "margem_pct", "impostos_pct", "taxas_pct", "desperdicio_pct", "custos_fixos_mensais", "embalagem_padrao", "desconto_livre_pct", "prazo_padrao_dias", "validade_orcamento_dias"];
  const campo = (k: string, l: string, hint?: string, suf?: string) => <Field label={l} hint={hint}><div className="relative"><Input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={suf ? "pr-14" : ""} />{suf && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suf}</span>}</div></Field>;
  const soma = (numOuNull(f.margem_pct) || 0) + (numOuNull(f.impostos_pct) || 0) + (numOuNull(f.taxas_pct) || 0);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const reg: Record<string, unknown> = {};
      const campos = aba === "precificacao" ? ["energia_kwh", "mao_obra_hora", "margem_pct", "impostos_pct", "taxas_pct", "desperdicio_pct", "custos_fixos_mensais", "embalagem_padrao", "desconto_livre_pct"]
        : ["fuso", "prefixo_pedido", "prefixo_orcamento", "prazo_padrao_dias", "validade_orcamento_dias", "msg_orcamento", "msg_pedido"];
      for (const k of campos) reg[k] = NUM.includes(k) ? numOuNull(f[k]) ?? 0 : f[k];
      await q(sb().from("empresa_config").update(reg).eq("empresa_id", app.empresa.id));
      toast("Configurações salvas"); app.recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  return (
    <Card>
      <form className="space-y-4" onSubmit={salvar}>
        <fieldset disabled={!app.podeEscrever} className="space-y-4">
          {aba === "precificacao" ? <>
            <Grid cols={3}>
              {campo("energia_kwh", "Energia elétrica", "Tarifa da conta de luz", "R$/kWh")}{campo("mao_obra_hora", "Mão de obra", undefined, "R$/h")}{campo("desperdicio_pct", "Desperdício médio", "Purga, suportes, falhas", "%")}
              {campo("margem_pct", "Margem de lucro padrão", "Clientes, produtos e materiais podem ter margem própria", "%")}{campo("impostos_pct", "Impostos sobre a venda", undefined, "%")}{campo("taxas_pct", "Taxas de pagamento", undefined, "%")}
              {campo("custos_fixos_mensais", "Custos fixos mensais", "Usado no lucro líquido estimado", "R$")}{campo("embalagem_padrao", "Embalagem padrão por item", "Preenche o item novo do orçamento", "R$")}
              {campo("desconto_livre_pct", "Desconto livre até", "Acima disso, só quem pode aprovar descontos", "%")}
            </Grid>
            {soma >= 100 ? <Aviso tom="vermelho">Margem + impostos + taxas = {soma}%. Precisa ser menor que 100%.</Aviso>
              : <Aviso>Preço = custo ÷ (1 − {soma.toLocaleString("pt-BR")}%). Um custo de R$ 10,00 vira <b>{brl(10 / (1 - soma / 100))}</b>. Custos fixos ficam fora do preço unitário para não serem contados duas vezes.</Aviso>}
          </> : <>
            <Grid cols={3}>
              <Field label="Moeda"><Input value="Real (BRL)" disabled /></Field>
              <Field label="Fuso horário"><Select value={f.fuso} onChange={(e) => setF({ ...f, fuso: e.target.value })}>{["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <span />
              <Field label="Prefixo dos pedidos"><Input maxLength={10} value={f.prefixo_pedido} onChange={(e) => setF({ ...f, prefixo_pedido: e.target.value })} /></Field>
              <Field label="Prefixo dos orçamentos"><Input maxLength={10} value={f.prefixo_orcamento} onChange={(e) => setF({ ...f, prefixo_orcamento: e.target.value })} /></Field>
              <span />
              {campo("prazo_padrao_dias", "Prazo padrão de entrega", undefined, "dias")}{campo("validade_orcamento_dias", "Validade dos orçamentos", undefined, "dias")}
            </Grid>
            <Field label="Mensagem de envio do orçamento" hint="Variáveis: {cliente} {numero} {empresa} {total} {link}"><Textarea value={f.msg_orcamento} onChange={(e) => setF({ ...f, msg_orcamento: e.target.value })} /></Field>
            <Field label="Mensagem de pedido" hint="Variáveis: {cliente} {numero} {prazo}"><Textarea value={f.msg_pedido} onChange={(e) => setF({ ...f, msg_pedido: e.target.value })} /></Field>
            <p className="text-xs text-slate-500">Status personalizados, modelos de documentos e unidades de medida extras chegam nas próximas fases.</p>
          </>}
          <div className="flex justify-end"><Button type="submit" loading={salvando} disabled={aba === "precificacao" && soma >= 100}>Salvar</Button></div>
        </fieldset>
      </form>
    </Card>
  );
}

type LinkAcesso = { id: string; token: string; nome: string; pode_pedidos: boolean; pode_gastos: boolean; pode_estoque: boolean; ativo: boolean; expira_em: string | null; ultimo_uso: string | null };
function Links() {
  const app = useApp();
  const [f, setF] = useState({ nome: "", pode_pedidos: true, pode_gastos: true, pode_estoque: true, expira_em: "" });
  const [excluir, setExcluir] = useState<LinkAcesso | null>(null);
  const { dados, recarregar } = useDados(() => q<LinkAcesso[]>(sb().from("links_acesso").select("*").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false })), [app.empresa.id]);
  const url = (t: string) => `${location.origin}/l/${t}`;
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await q(sb().from("links_acesso").insert({ empresa_id: app.empresa.id, nome: f.nome, created_by: app.userId, pode_pedidos: f.pode_pedidos, pode_gastos: f.pode_gastos, pode_estoque: f.pode_estoque, expira_em: f.expira_em ? `${f.expira_em}T23:59:59-03:00` : null })); toast("Link criado"); setF({ nome: "", pode_pedidos: true, pode_gastos: true, pode_estoque: true, expira_em: "" }); recarregar(); } catch (e2) { erro(e2); } }}>
          <p className="text-sm text-slate-600 dark:text-slate-300">Para quem lança pedidos, gastos ou estoque sem ter conta (ex.: um ajudante). Quem tiver o link consegue lançar — envie só para quem confia.</p>
          <Field label="Nome do link"><Input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Ajudante João" /></Field>
          <Checkbox label="Pode lançar pedidos" checked={f.pode_pedidos} onChange={(v) => setF({ ...f, pode_pedidos: v })} />
          <Checkbox label="Pode lançar gastos" checked={f.pode_gastos} onChange={(v) => setF({ ...f, pode_gastos: v })} />
          <Checkbox label="Pode movimentar matéria-prima" checked={f.pode_estoque} onChange={(v) => setF({ ...f, pode_estoque: v })} />
          <Field label="Expira em (opcional)"><Input type="date" value={f.expira_em} onChange={(e) => setF({ ...f, expira_em: e.target.value })} /></Field>
          <Button type="submit" className="w-full" disabled={!app.podeEscrever}><Plus className="h-4 w-4" /> Criar link</Button>
        </form>
      </Card>
      <Card>
        {!dados?.length ? <Empty texto="Nenhum link criado" /> : (
          <div className="space-y-3">{dados.map((l) => {
            const exp = !!l.expira_em && new Date(l.expira_em) < new Date();
            return (
              <div key={l.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-medium">{l.nome}</span> {!l.ativo ? <Badge>desativado</Badge> : exp ? <Badge tom="vermelho">expirado</Badge> : <Badge tom="verde">ativo</Badge>}
                    <div className="text-xs text-slate-500">{[l.pode_pedidos && "pedidos", l.pode_gastos && "gastos", l.pode_estoque && "matéria-prima"].filter(Boolean).join(", ")} · último uso {dataHora(l.ultimo_uso)}</div></div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(url(l.token)); toast("Link copiado"); }}><Copy className="h-4 w-4" /></Button>
                    <a href={`https://wa.me/?text=${encodeURIComponent("Use este link para lançar pedidos e gastos: " + url(l.token))}`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4" /></Button></a>
                    <Button size="sm" variant="secondary" onClick={async () => { try { await q(sb().from("links_acesso").update({ ativo: !l.ativo }).eq("id", l.id)); recarregar(); } catch (e) { erro(e); } }}>{l.ativo ? "Desativar" : "Ativar"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setExcluir(l)} aria-label="Excluir"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </div>
                </div>
                <div className="mt-2 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs dark:bg-slate-800">{url(l.token)}</div>
              </div>);
          })}</div>
        )}
      </Card>
      <Confirmar aberto={!!excluir} titulo="Excluir link" perigo confirmar="Excluir" onCancel={() => setExcluir(null)}
        onOk={async () => { try { await q(sb().from("links_acesso").delete().eq("id", excluir!.id)); toast("Link excluído"); setExcluir(null); recarregar(); } catch (e) { erro(e); } }}
        texto="Quem tiver o link perde o acesso. Os lançamentos feitos por ele continuam salvos." />
    </div>
  );
}

const EXPORTS: [string, string, string][] = [
  ["clientes", "Clientes", "clientes_ver"], ["produtos", "Produtos", "produtos_ver"], ["materiais", "Matéria-prima", "materia_ver"],
  ["movimentacoes_estoque", "Movimentações de estoque", "materia_ver"], ["impressoras", "Impressoras", "impressoras_ver"],
  ["orcamentos", "Orçamentos", "orcamentos_ver"], ["pedidos", "Pedidos", "pedidos_ver"], ["gastos", "Gastos", "financeiro_ver"],
];
function Exportar() {
  const app = useApp();
  const [baixando, setBaixando] = useState<string | null>(null);
  const baixar = async (tabela: string) => {
    setBaixando(tabela);
    try {
      const linhas: Record<string, unknown>[] = [];
      for (let de = 0; ; de += 1000) {
        const parte = await q<Record<string, unknown>[]>(sb().from(tabela).select("*").eq("empresa_id", app.empresa.id).range(de, de + 999));
        linhas.push(...parte); if (parte.length < 1000) break;
      }
      if (!linhas.length) { toast("Nada para exportar"); return; }
      const cols = Object.keys(linhas[0]).filter((c) => c !== "empresa_id");
      const csv = "﻿" + [cols, ...linhas.map((l) => cols.map((c) => { const v = l[c]; return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }))]
        .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${tabela}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    } catch (e) { erro(e); } finally { setBaixando(null); }
  };
  return (
    <Card>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Baixe uma cópia dos seus dados em CSV (abre no Excel ou Google Planilhas). O servidor também faz backup automático diário do banco inteiro.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {EXPORTS.filter(([, , p]) => app.pode(p)).map(([t, n]) => <Button key={t} variant="secondary" loading={baixando === t} onClick={() => baixar(t)}><Download className="h-4 w-4" /> {n}</Button>)}
      </div>
    </Card>
  );
}

function Seguranca() {
  const [s, setS] = useState({ a: "", b: "" });
  return (
    <Card>
      <form className="max-w-sm space-y-3" onSubmit={async (e) => { e.preventDefault(); try { if (s.a.length < 8) throw new Error("Use pelo menos 8 caracteres"); if (s.a !== s.b) throw new Error("As senhas não conferem"); const { error } = await sb().auth.updateUser({ password: s.a }); if (error) throw error; toast("Senha alterada"); setS({ a: "", b: "" }); } catch (e2) { erro(e2); } }}>
        <h2 className="font-semibold">Trocar minha senha</h2>
        <Field label="Nova senha"><Input type="password" autoComplete="new-password" value={s.a} onChange={(e) => setS({ ...s, a: e.target.value })} /></Field>
        <Field label="Repita a nova senha"><Input type="password" autoComplete="new-password" value={s.b} onChange={(e) => setS({ ...s, b: e.target.value })} /></Field>
        <Button type="submit">Alterar senha</Button>
      </form>
      <p className="mt-6 text-xs text-slate-500">Todos os dados da sua empresa ficam isolados das outras empresas, com regras de acesso no próprio banco. Arquivos são privados e abertos só por links temporários. Alterações importantes ficam registradas em Equipe → Registro de alterações.</p>
    </Card>
  );
}
