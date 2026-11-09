"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Link2, Plug, RefreshCw, Store, Unplug } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, dataHora } from "@/lib/utils";
import { Aviso, Badge, Button, Card, CardTitle, Checkbox, Confirmar, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Table, Tabs, Td } from "@/components/ui";

type Aba = "contas" | "anuncios" | "vendas" | "historico";
type Conta = { id: string; conta_externa_id: number; apelido: string | null; status: string; erro: string | null; importar_pedidos: boolean; baixar_estoque: boolean;
  registrar_tarifas: boolean; conectada_em: string; ultima_sincronizacao: string | null };
type Anuncio = { id: string; conta_id: string; item_id: string; variacao_id: number | null; titulo: string | null; variacao_nome: string | null; sku: string | null; status_externo: string | null;
  logistica: string | null; preco: number | null; estoque_externo: number | null; link: string | null; produto_id: string | null; variante_id: string | null; sincronizar_estoque: boolean;
  ultimo_estoque_enviado: number | null; estoque_enviado_em: string | null; erro_estoque: string | null };
type Venda = { id: string; pedido_externo_id: number; pack_id: number | null; pedido_id: string | null; status_externo: string | null; comprador: string | null; total: number | null; tarifa: number;
  envio_modo: string | null; envio_status: string | null; rastreio_ml: string | null; rastreio_enviado: string | null; erro_rastreio: string | null; data_venda: string | null; aviso: string | null; pedidos: { numero: number } | null };
type Produto = { id: string; nome: string; codigo: string | null; controla_estoque: boolean; estoque_qtd: number };
type Variante = { id: string; produto_id: string; nome: string; estoque_qtd: number };

const ERROS: Record<string, string> = {
  negado: "Você não autorizou o acesso no Mercado Livre.", expirado: "O link de conexão expirou ou já foi usado. Tente de novo.", invalido: "Retorno inválido do Mercado Livre. Tente de novo.",
  outra_empresa: "Esta conta do Mercado Livre já está ligada a outra empresa no sistema.", sessao: "A conexão precisa ser concluída no mesmo navegador em que você clicou em Conectar.", falha: "Não foi possível concluir a conexão. Tente de novo em alguns minutos.",
};
const ENVIO: Record<string, string> = { me2: "Mercado Envios (etiqueta do ML)", me1: "Mercado Envios 1 (envio próprio)", custom: "Envio personalizado", not_specified: "A combinar" };
const SIT_ML: Record<string, string> = { paid: "Paga", cancelled: "Cancelada", partially_refunded: "Reembolso parcial", confirmed: "Confirmada", payment_required: "Aguardando pagamento" };

export default function Marketplaces() {
  const app = useApp();
  const abaUrl = useParam("aba"), conectado = useParam("conectado"), erroUrl = useParam("erro");
  const [aba, setAba] = useState<Aba>("contas");
  useEffect(() => { if (abaUrl) setAba(abaUrl as Aba); }, [abaUrl]);
  useEffect(() => {
    if (conectado) toast("Mercado Livre conectado! Importando anúncios e vendas…");
    if (erroUrl) toast(ERROS[erroUrl] || ERROS.falha, "erro");
    if (conectado || erroUrl) history.replaceState(null, "", "/integracoes/marketplaces/");
  }, [conectado, erroUrl]);
  const admin = app.pode("integracoes_config");
  const abas: [Aba, string][] = [["contas", "Contas"], ...((admin || app.pode("produtos_ver")) ? [["anuncios", "Anúncios e estoque"]] as [Aba, string][] : []),
    ["vendas", "Vendas importadas"], ...(admin ? [["historico", "Histórico"]] as [Aba, string][] : [])];
  return (
    <>
      <PageHeader titulo="Integrações › Marketplaces" sub="Mercado Livre: vendas viram pedidos, o estoque dos anúncios segue o do sistema e o rastreio vai e volta" />
      <Tabs abas={abas} ativa={aba} onChange={setAba} />
      {aba === "contas" && <Contas />}
      {aba === "anuncios" && <Anuncios />}
      {aba === "vendas" && <Vendas />}
      {aba === "historico" && <Historico />}
    </>
  );
}

function Contas() {
  const app = useApp();
  const admin = app.pode("integracoes_config");
  const [conectando, setConectando] = useState(false);
  const [sair, setSair] = useState<Conta | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<Conta[]>(sb().from("marketplace_contas")
    .select("id,conta_externa_id,apelido,status,erro,importar_pedidos,baixar_estoque,registrar_tarifas,conectada_em,ultima_sincronizacao")
    .eq("empresa_id", app.empresa.id).neq("status", "desconectada").order("conectada_em")), [app.empresa.id]);
  useEffect(() => { const t = setInterval(recarregar, 20000); return () => clearInterval(t); }, [recarregar]);
  const conectar = async () => {
    setConectando(true);
    try { const r = await rpc<{ url: string }>("ml_iniciar_conexao", { p_empresa: app.empresa.id }); window.location.href = r.url; }
    catch (e) { erro(e); setConectando(false); }
  };
  const config = async (c: Conta, campo: string, valor: boolean) => { try { await rpc("marketplace_config", { p_conta: c.id, p: { [campo]: valor } }); recarregar(); } catch (e) { erro(e); } };

  return (
    <div className="space-y-4">
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : <>
        {(dados || []).map((c) => (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3"><Store className="h-8 w-8 text-amber-500" />
                <div><div className="font-semibold">Mercado Livre · {c.apelido || c.conta_externa_id}</div>
                  <div className="text-sm text-slate-500">Conectada em {dataHora(c.conectada_em)}{c.ultima_sincronizacao ? ` · última sincronização ${dataHora(c.ultima_sincronizacao)}` : " · sincronizando…"}</div></div></div>
              <Badge tom={c.status === "conectada" ? "verde" : "vermelho"}>{c.status === "conectada" ? "Conectada" : "Com erro"}</Badge>
            </div>
            {c.erro && <div className="mt-3"><Aviso tom="vermelho">{c.erro}</Aviso></div>}
            {admin && <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Checkbox label="Importar vendas pagas como pedidos" checked={c.importar_pedidos} onChange={(v) => config(c, "importar_pedidos", v)} />
              <Checkbox label="Venda baixa o estoque do produto" hint="Só produtos com “Controla estoque”" checked={c.baixar_estoque} onChange={(v) => config(c, "baixar_estoque", v)} />
              <Checkbox label="Registrar tarifa do ML como despesa" checked={c.registrar_tarifas} onChange={(v) => config(c, "registrar_tarifas", v)} />
            </div>}
            {admin && <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={async () => { try { await rpc("marketplace_sincronizar", { p_conta: c.id }); toast("Sincronização pedida: anúncios e vendas em instantes"); } catch (e) { erro(e); } }}><RefreshCw className="h-4 w-4" /> Sincronizar agora</Button>
              {c.status === "erro" && <Button size="sm" onClick={conectar} loading={conectando}><Plug className="h-4 w-4" /> Conectar de novo</Button>}
              <Button variant="ghost" size="sm" onClick={() => setSair(c)}><Unplug className="h-4 w-4" /> Desconectar</Button>
            </div>}
          </Card>))}
        {!dados?.length && <Card><div className="flex flex-col items-center gap-3 py-6 text-center">
          <Store className="h-10 w-10 text-amber-500" />
          <div className="font-semibold">Conecte sua conta do Mercado Livre</div>
          <p className="max-w-lg text-sm text-slate-500">Você entra no Mercado Livre e autoriza o acesso: a senha fica com o Mercado Livre, não com o sistema. Depois disso, as vendas pagas viram pedidos, o estoque dos anúncios vinculados segue o do sistema e o código de rastreio vai e volta.</p>
          {admin ? <Button onClick={conectar} loading={conectando}><Plug className="h-4 w-4" /> Conectar Mercado Livre</Button> : <p className="text-sm text-slate-500">Peça ao dono ou a um administrador para conectar.</p>}
        </div></Card>}
        <Card>
          <CardTitle>Como funciona</CardTitle>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li><b>Vendas:</b> cada venda paga vira um pedido com cliente, itens e pagamento. Carrinho com vários itens vira um pedido só. Vendas anteriores à conexão não entram.</li>
            <li><b>Estoque:</b> em <i>Anúncios e estoque</i>, vincule o anúncio a um produto com “Controla estoque” e ligue a sincronização: a quantidade do anúncio passa a ser a do sistema. Anúncios do Full não são alterados.</li>
            <li><b>Rastreio:</b> Mercado Envios com etiqueta do ML: o código vem do ML para a expedição. Envio próprio (ME1 ou personalizado): o código que você coloca na expedição vai para o ML.</li>
            <li><b>Cancelamento no ML:</b> o sistema avisa, mas não cancela o pedido sozinho (pode já ter produção ou estoque baixado).</li>
          </ul>
        </Card>
      </>}
      <Confirmar aberto={!!sair} titulo="Desconectar Mercado Livre" perigo confirmar="Desconectar" onCancel={() => setSair(null)}
        texto="O acesso é apagado do sistema e a sincronização para. Pedidos já importados continuam. Para conectar de novo é só autorizar outra vez."
        onOk={async () => { try { await rpc("marketplace_desconectar", { p_conta: sair!.id }); toast("Mercado Livre desconectado"); setSair(null); recarregar(); } catch (e) { erro(e); } }} />
    </div>
  );
}

function Anuncios() {
  const app = useApp();
  const pode = app.pode("integracoes_config") || app.pode("produtos_editar");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("");
  const [ed, setEd] = useState<Anuncio | null>(null);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [an, pr, va] = await Promise.all([
      q<Anuncio[]>(sb().from("marketplace_anuncios").select("id,conta_id,item_id,variacao_id,titulo,variacao_nome,sku,status_externo,logistica,preco,estoque_externo,link,produto_id,variante_id,sincronizar_estoque,ultimo_estoque_enviado,estoque_enviado_em,erro_estoque")
        .eq("empresa_id", app.empresa.id).order("titulo").limit(2000)),
      q<Produto[]>(sb().from("produtos").select("id,nome,codigo,controla_estoque,estoque_qtd").eq("empresa_id", app.empresa.id).neq("status", "inativo").order("nome").limit(2000)),
      q<Variante[]>(sb().from("produto_variantes").select("id,produto_id,nome,estoque_qtd").eq("empresa_id", app.empresa.id).eq("ativo", true).limit(5000)),
    ]);
    return { an, pr, va };
  }, [app.empresa.id]);
  const prod = useMemo(() => new Map((dados?.pr || []).map((p) => [p.id, p])), [dados]);
  const lista = (dados?.an || []).filter((a) => (!busca || `${a.titulo} ${a.sku} ${a.item_id}`.toLowerCase().includes(busca.toLowerCase()))
    && (!filtro || (filtro === "sem" ? !a.produto_id : filtro === "sync" ? a.sincronizar_estoque : !!a.erro_estoque)));
  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="min-w-60 flex-1" placeholder="Buscar por título, SKU ou código do anúncio" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Select className="w-56" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtro"><option value="">Todos</option><option value="sem">Sem produto vinculado</option><option value="sync">Estoque sincronizado</option><option value="erro">Com erro de estoque</option></Select>
      </div>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !lista.length ? <Empty texto={dados?.an.length ? "Nenhum anúncio com esse filtro" : "Nenhum anúncio ainda. Conecte a conta e aguarde a sincronização."} /> : (
        <Table head={["Anúncio", "Produto no sistema", "Estoque ML", "Sistema", ""]}>{lista.map((a) => {
          const p = a.produto_id ? prod.get(a.produto_id) : null;
          const v = a.variante_id ? dados!.va.find((x) => x.id === a.variante_id) : null;
          return (
            <tr key={a.id}>
              <Td><div className="font-medium">{a.titulo}{a.variacao_nome ? <span className="text-slate-500"> · {a.variacao_nome}</span> : null}</div>
                <div className="flex items-center gap-2 text-xs text-slate-500">{a.item_id}{a.sku ? ` · SKU ${a.sku}` : ""}{a.preco != null ? ` · ${brl(a.preco)}` : ""}{a.logistica === "fulfillment" ? " · Full" : ""}
                  {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" aria-label="Abrir no Mercado Livre"><ExternalLink className="h-3.5 w-3.5" /></a>}</div></Td>
              <Td>{p ? <div><div className="text-sm">{p.nome}{v ? ` · ${v.nome}` : ""}</div>{a.sincronizar_estoque ? <Badge tom="verde">Estoque sincronizado</Badge> : <span className="text-xs text-slate-500">sem sincronizar estoque</span>}</div>
                : <Badge tom="amarelo">Sem vínculo</Badge>}
                {a.erro_estoque && <div className="mt-1 text-xs text-red-600">{a.erro_estoque}</div>}</Td>
              <Td className="tnum">{a.estoque_externo ?? "—"}</Td>
              <Td className="tnum">{p?.controla_estoque ? Math.floor(Number(v ? v.estoque_qtd : p.estoque_qtd)) : "—"}</Td>
              <Td>{pode && <Button size="sm" variant="ghost" onClick={() => setEd(a)}><Link2 className="h-4 w-4" /> Vincular</Button>}</Td>
            </tr>);
        })}</Table>)}
      <p className="mt-3 text-xs text-slate-500">Dica: se o SKU do anúncio for igual ao código do produto (ou ao SKU da variação), o vínculo é feito sozinho.</p>
      {ed && dados && <Vincular a={ed} produtos={dados.pr} variantes={dados.va} onClose={() => setEd(null)} onSalvo={() => { setEd(null); recarregar(); }} />}
    </Card>
  );
}

function Vincular({ a, produtos, variantes, onClose, onSalvo }: { a: Anuncio; produtos: Produto[]; variantes: Variante[]; onClose: () => void; onSalvo: () => void }) {
  const [produto, setProduto] = useState(a.produto_id || "");
  const [variante, setVariante] = useState(a.variante_id || "");
  const [sync, setSync] = useState(a.sincronizar_estoque);
  const [salvando, setSalvando] = useState(false);
  const p = produtos.find((x) => x.id === produto);
  const vars = variantes.filter((v) => v.produto_id === produto);
  return (
    <Modal aberto titulo="Vincular anúncio a um produto" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm"><b>{a.titulo}</b>{a.variacao_nome ? ` · ${a.variacao_nome}` : ""} <span className="text-slate-500">({a.item_id})</span></p>
        <Field label="Produto"><Select value={produto} onChange={(e) => { setProduto(e.target.value); setVariante(""); }}><option value="">— sem vínculo —</option>
          {produtos.map((x) => <option key={x.id} value={x.id}>{x.nome}{x.codigo ? ` (${x.codigo})` : ""}</option>)}</Select></Field>
        {vars.length > 0 && <Field label="Variação"><Select value={variante} onChange={(e) => setVariante(e.target.value)}><option value="">Produto (sem variação)</option>{vars.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</Select></Field>}
        {produto && (p?.controla_estoque
          ? <Checkbox label="Sincronizar estoque: a quantidade do anúncio passa a ser a do sistema" checked={sync} onChange={setSync} />
          : <Aviso tom="amarelo">Este produto não controla estoque (sob encomenda): as vendas entram como pedido, mas a quantidade do anúncio continua a do Mercado Livre.</Aviso>)}
        {a.logistica === "fulfillment" && sync && <Aviso tom="amarelo">Anúncio no Full: o estoque é do depósito do Mercado Livre e não é alterado pelo sistema.</Aviso>}
        <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={salvando} onClick={async () => { setSalvando(true);
            try { await rpc("marketplace_vincular_anuncio", { p_anuncio: a.id, p_produto: produto || null, p_variante: variante || null, p_sincronizar: !!produto && !!p?.controla_estoque && sync }); toast("Vínculo salvo"); onSalvo(); }
            catch (e) { erro(e); } finally { setSalvando(false); } }}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function Vendas() {
  const app = useApp();
  const [so, setSo] = useState("");
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<Venda[]>(sb().from("marketplace_pedidos")
    .select("id,pedido_externo_id,pack_id,pedido_id,status_externo,comprador,total,tarifa,envio_modo,envio_status,rastreio_ml,rastreio_enviado,erro_rastreio,data_venda,aviso,pedidos(numero)")
    .eq("empresa_id", app.empresa.id).order("data_venda", { ascending: false }).limit(500)), [app.empresa.id]);
  const lista = (dados || []).filter((v) => !so || (so === "aviso" ? !!v.aviso : v.status_externo === so));
  return (
    <Card>
      <CardTitle right={<Select className="w-52" value={so} onChange={(e) => setSo(e.target.value)} aria-label="Filtro"><option value="">Todas</option><option value="aviso">Precisam de atenção</option><option value="cancelled">Canceladas no ML</option></Select>}>Vendas do Mercado Livre</CardTitle>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !lista.length ? <Empty texto="Nenhuma venda importada ainda" /> : (
        <Table head={["Venda", "Comprador", "Total", "Envio", "Pedido no sistema"]}>{lista.map((v) => (
          <tr key={v.id}>
            <Td><div className="font-medium">#{v.pedido_externo_id}</div><div className="text-xs text-slate-500">{v.data_venda ? dataHora(v.data_venda) : ""}{v.pack_id ? ` · carrinho ${v.pack_id}` : ""}</div>
              <Badge tom={v.status_externo === "cancelled" ? "vermelho" : "verde"}>{SIT_ML[v.status_externo || ""] || v.status_externo}</Badge>
              {v.aviso && <div className="mt-1 max-w-xs text-xs text-amber-700 dark:text-amber-400">{v.aviso}</div>}</Td>
            <Td>{v.comprador}</Td>
            <Td className="tnum">{brl(v.total)}<div className="text-xs text-slate-500">tarifa {brl(v.tarifa)}</div></Td>
            <Td className="text-sm">{ENVIO[v.envio_modo || ""] || v.envio_modo || "—"}
              {(v.rastreio_ml || v.rastreio_enviado) && <div className="text-xs text-slate-500">Rastreio {v.rastreio_ml || v.rastreio_enviado}{v.rastreio_enviado ? " (enviado ao ML)" : ""}</div>}
              {v.erro_rastreio && <div className="text-xs text-red-600">{v.erro_rastreio}</div>}</Td>
            <Td>{v.pedido_id ? <Link className="text-brand-700 underline" href={`/pedidos/?id=${v.pedido_id}`}>Pedido #{v.pedidos?.numero}</Link> : "—"}</Td>
          </tr>))}</Table>)}
    </Card>
  );
}

function Historico() {
  const app = useApp();
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<{ id: number; tipo: string; mensagem: string; created_at: string }[]>(
    sb().from("integracao_eventos").select("id,tipo,mensagem,created_at").eq("empresa_id", app.empresa.id).eq("provedor", "mercado_livre").order("id", { ascending: false }).limit(500)), [app.empresa.id]);
  return (
    <Card>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !dados?.length ? <Empty texto="Nada registrado ainda" /> : (
        <Table head={["Quando", "Tipo", "Descrição"]}>{dados.map((e) => (
          <tr key={e.id}><Td className="whitespace-nowrap text-sm">{dataHora(e.created_at)}</Td>
            <Td><Badge tom={e.tipo === "erro" ? "vermelho" : e.tipo === "importacao" ? "verde" : e.tipo === "desconexao" ? "cinza" : "azul"}>{({ importacao: "Venda", atualizacao: "Atualização", erro: "Erro", conexao: "Conexão", desconexao: "Desconexão" } as Record<string, string>)[e.tipo] || e.tipo}</Badge></Td>
            <Td className="text-sm">{e.mensagem}</Td></tr>))}</Table>)}
    </Card>
  );
}
