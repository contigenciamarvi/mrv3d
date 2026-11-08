"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Copy, FileText, Search, Ban, MessageCircle, Download } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc, urlTemporaria } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, dataHora, linkWhats, STATUS_PORTAL, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Checkbox, Confirmar, Aviso, Tabs } from "@/components/ui";

type Sol = { id: string; numero: number; token: string; status: string; nome: string; email: string | null; telefone: string | null; cidade: string | null; produto_id: string | null; material_id: string | null;
  cor: string | null; quantidade: number; observacoes: string | null; arquivos: { path: string; nome: string; tamanho: number | null }[]; orcamento_id: string | null; motivo_recusa: string | null; created_at: string;
  produtos: { nome: string } | null; materiais: { nome: string; cor: string | null } | null; orcamentos: { numero: number; status: string } | null };
type Cfg = { empresa_id: string; ativo: boolean; slug: string | null; titulo: string | null; descricao: string | null; whatsapp: string | null; mostrar_precos: boolean; aceitar_arquivos: boolean;
  materiais_ids: string[]; cores: string | null; prazo_texto: string | null; mensagem_sucesso: string | null };
type Aba = "solicitacoes" | "config";
const linkLoja = (slug: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/loja/?s=${slug}`;
const linkAcomp = (t: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/acompanhar/?t=${t}`;

export default function Portal() { return <Exige perm={["orcamentos_ver", "orcamentos_criar", "config_editar"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const idUrl = useParam("id");
  const verSol = app.pode("orcamentos_ver") || app.pode("orcamentos_criar");
  const [aba, setAba] = useState<Aba>(verSol ? "solicitacoes" : "config");
  const [aberta, setAberta] = useState<string | null>(null);
  useEffect(() => { if (idUrl) setAberta(idUrl); }, [idUrl]);
  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [sols, [cfg]] = await Promise.all([
      verSol ? q<Sol[]>(sb().from("portal_solicitacoes").select("*,produtos(nome),materiais(nome,cor),orcamentos(numero,status)").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(1000)) : Promise.resolve([] as Sol[]),
      q<Cfg[]>(sb().from("portal_config").select("*").eq("empresa_id", app.empresa.id)),
    ]);
    return { sols, cfg: cfg || null };
  }, [app.empresa.id]);
  const novas = (dados?.sols || []).filter((s) => s.status === "nova").length;
  return (
    <>
      <PageHeader titulo="Portal do Comprador" sub="Página da sua loja para clientes pedirem orçamento, enviarem arquivos 3D e acompanharem o pedido"
        acoes={dados?.cfg?.ativo && dados.cfg.slug ? <a href={linkLoja(dados.cfg.slug)} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="h-4 w-4" /> Abrir minha loja</Button></a> : undefined} />
      <Tabs abas={[...(verSol ? [["solicitacoes", `Solicitações${novas ? ` (${novas} novas)` : ""}`] as [Aba, string]] : []), ...(app.pode("config_editar") ? [["config", "Configurar portal"] as [Aba, string]] : [])]} ativa={aba} onChange={setAba} />
      {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
      {carregando && !dados ? <Loading /> : dados && <>
        {aba === "solicitacoes" && <Card>
          {!dados.cfg?.ativo && <div className="mb-4"><Aviso tom="amarelo">O portal está desligado. {app.pode("config_editar") ? "Configure e ative na aba Configurar portal." : "Peça ao proprietário para ativar."}</Aviso></div>}
          {!dados.sols.length ? <Empty texto="Nenhuma solicitação ainda" /> : (
            <Table head={["Nº", "Recebida", "Comprador", "Pedido", "Situação"]}>{dados.sols.map((s) => (
              <tr key={s.id} className={cn("cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50", s.status === "nova" && "font-medium")} onClick={() => setAberta(s.id)}>
                <Td>#{s.numero}</Td><Td>{dataHora(s.created_at)}</Td><Td><div>{s.nome}</div><div className="text-xs font-normal text-slate-500">{[s.email, s.telefone, s.cidade].filter(Boolean).join(" · ")}</div></Td>
                <Td>{num(s.quantidade)} × {s.produtos?.nome || (s.arquivos.length ? s.arquivos.map((a) => a.nome).join(", ") : "Peça sob encomenda")}</Td>
                <Td><Badge tom={tomStatus(s.status)}>{STATUS_PORTAL[s.status]}</Badge>{s.orcamentos && <div className="text-xs font-normal text-slate-500">Orçamento #{s.orcamentos.numero}</div>}</Td></tr>))}</Table>)}
        </Card>}
        {aba === "config" && <Config cfg={dados.cfg} onMudou={recarregar} />}
      </>}
      {aberta && dados && <Detalhe s={dados.sols.find((x) => x.id === aberta) || null} onClose={() => { setAberta(null); if (idUrl) history.replaceState(null, "", "/portal/"); }} onMudou={recarregar} />}
    </>
  );
}

function Detalhe({ s, onClose, onMudou }: { s: Sol | null; onClose: () => void; onMudou: () => void }) {
  const app = useApp();
  const router = useRouter();
  const orca = app.pode("orcamentos_criar") && app.podeEscrever;
  const [recusar, setRecusar] = useState("");
  const [abrirRecusa, setAbrirRecusa] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  if (!s) return null;
  const mudar = async (status: string, motivo?: string) => { setOcupado(true); try { await rpc("portal_mudar_status", { p_id: s.id, p_status: status, p_motivo: motivo || null }); toast(STATUS_PORTAL[status]); setAbrirRecusa(false); onMudou(); } catch (e) { erro(e); } finally { setOcupado(false); } };
  const gerar = async () => { setOcupado(true); try { const id = await rpc<string>("portal_gerar_orcamento", { p_id: s.id }); onMudou(); router.push(`/orcamentos/editar/?id=${id}`); } catch (e) { erro(e); setOcupado(false); } };
  const whats = linkWhats(s.telefone, `Olá ${s.nome.split(" ")[0]}! Recebemos sua solicitação #${s.numero} pela loja da ${app.empresa.nome}. Acompanhe por aqui: ${linkAcomp(s.token)}`);
  return (
    <Modal aberto titulo={`Solicitação #${s.numero}`} onClose={onClose} largura="max-w-2xl">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tom={tomStatus(s.status)}>{STATUS_PORTAL[s.status]}</Badge><span className="text-slate-500">recebida {dataHora(s.created_at)}</span></div>
        <Grid>
          <div><div className="text-xs text-slate-500">Comprador</div><div className="font-medium">{s.nome}</div><div>{[s.email, s.telefone].filter(Boolean).join(" · ")}</div>{s.cidade && <div>{s.cidade}</div>}</div>
          <div><div className="text-xs text-slate-500">Pedido</div><div className="font-medium">{num(s.quantidade)} × {s.produtos?.nome || "Peça sob encomenda"}</div>
            <div>{[s.materiais && `${s.materiais.nome}${s.materiais.cor ? ` ${s.materiais.cor}` : ""}`, s.cor && `cor ${s.cor}`].filter(Boolean).join(" · ") || "Material a combinar"}</div></div>
        </Grid>
        {s.observacoes && <div><div className="text-xs text-slate-500">Observações</div><p className="whitespace-pre-line">{s.observacoes}</p></div>}
        {s.arquivos.length > 0 && <div><div className="mb-1 text-xs text-slate-500">Arquivos 3D</div>
          <ul className="space-y-1">{s.arquivos.map((a) => <li key={a.path}><button className="inline-flex items-center gap-1 text-brand-600 underline" onClick={async () => { try { window.open(await urlTemporaria(a.path), "_blank"); } catch (e) { erro(e); } }}>
            <Download className="h-3.5 w-3.5" /> {a.nome}</button>{a.tamanho ? <span className="text-xs text-slate-500"> · {num(a.tamanho / 1048576, 1)} MB</span> : null}</li>)}</ul></div>}
        {s.motivo_recusa && <Aviso tom="vermelho">Recusada: {s.motivo_recusa}</Aviso>}
        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="text-xs text-slate-500">Link de acompanhamento do comprador</div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(linkAcomp(s.token)); toast("Link copiado"); }}><Copy className="h-4 w-4" /> Copiar link</Button>
            {whats && <a href={whats} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><MessageCircle className="h-4 w-4" /> Enviar no WhatsApp</Button></a>}
          </div>
          <p className="mt-1 text-xs text-slate-500">O comprador vê a proposta, aprova e acompanha produção e entrega por esse link.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {s.orcamento_id ? <Button onClick={() => router.push(`/orcamentos/editar/?id=${s.orcamento_id}`)}><FileText className="h-4 w-4" /> Abrir orçamento #{s.orcamentos?.numero}</Button> : orca && <>
            {s.status === "nova" && <Button variant="secondary" loading={ocupado} onClick={() => mudar("em_analise")}><Search className="h-4 w-4" /> Em análise</Button>}
            {s.status === "recusada" ? <Button variant="secondary" loading={ocupado} onClick={() => mudar("em_analise")}>Reabrir</Button>
              : <Button variant="ghost" onClick={() => setAbrirRecusa(true)}><Ban className="h-4 w-4" /> Recusar</Button>}
            {s.status !== "recusada" && <Button loading={ocupado} onClick={gerar}><FileText className="h-4 w-4" /> Criar orçamento</Button>}</>}
        </div>
      </div>
      <Confirmar aberto={abrirRecusa} titulo="Recusar solicitação" perigo confirmar="Recusar" carregando={ocupado} onCancel={() => setAbrirRecusa(false)} onOk={() => mudar("recusada", recusar)}
        texto="O comprador verá o motivo no link de acompanhamento.">
        <div className="mt-2"><Field label="Motivo"><Input autoFocus value={recusar} onChange={(e) => setRecusar(e.target.value)} placeholder="Ex.: peça maior que o volume das nossas impressoras" /></Field></div>
      </Confirmar>
    </Modal>
  );
}

function Config({ cfg, onMudou }: { cfg: Cfg | null; onMudou: () => void }) {
  const app = useApp();
  const [f, setF] = useState<Cfg>(cfg || { empresa_id: app.empresa.id, ativo: false, slug: app.empresa.nome.normalize("NFD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_]+/g, "-").slice(0, 40),
    titulo: app.empresa.nome, descricao: "", whatsapp: "", mostrar_precos: true, aceitar_arquivos: true, materiais_ids: [], cores: "Preto, Branco, Cinza, Vermelho, Azul", prazo_texto: "", mensagem_sucesso: "" });
  const [salvando, setSalvando] = useState(false);
  const { dados } = useDados(async () => {
    const [mats, prods] = await Promise.all([
      q<{ id: string; nome: string; cor: string | null; categoria: string }[]>(sb().from("materiais").select("id,nome,cor,categoria").eq("empresa_id", app.empresa.id).eq("ativo", true).in("categoria", ["filamento", "resina"]).order("nome")),
      q<{ id: string; nome: string; preco_venda: number; status: string; no_portal: boolean; foto_path: string | null }[]>(sb().from("produtos").select("id,nome,preco_venda,status,no_portal,foto_path").eq("empresa_id", app.empresa.id).eq("status", "ativo").order("nome")),
    ]);
    return { mats, prods };
  }, [app.empresa.id]);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const v = { empresa_id: app.empresa.id, ativo: f.ativo, slug: f.slug?.trim().toLowerCase() || null, titulo: f.titulo || null, descricao: f.descricao || null, whatsapp: f.whatsapp || null,
        mostrar_precos: f.mostrar_precos, aceitar_arquivos: f.aceitar_arquivos, materiais_ids: f.materiais_ids, cores: f.cores || null, prazo_texto: f.prazo_texto || null, mensagem_sucesso: f.mensagem_sucesso || null };
      await q(cfg ? sb().from("portal_config").update(v).eq("empresa_id", app.empresa.id) : sb().from("portal_config").insert(v));
      toast(f.ativo ? "Portal salvo e no ar" : "Portal salvo (desligado)"); onMudou();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const alternarProduto = async (id: string, v: boolean) => { try { await q(sb().from("produtos").update({ no_portal: v }).eq("id", id)); toast(v ? "Produto aparece na loja" : "Produto saiu da loja"); } catch (e) { erro(e); } };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card>
        <form className="space-y-4" onSubmit={salvar}>
          <Checkbox label="Portal ativo" hint="Desligado, a página sai do ar e ninguém consegue enviar pedidos" checked={f.ativo} onChange={(v) => setF({ ...f, ativo: v })} />
          <Field label="Endereço da loja" hint={f.slug ? linkLoja(f.slug) : "Letras minúsculas, números e hífen"}><Input required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" value={f.slug || ""} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></Field>
          <Grid>
            <Field label="Título da página"><Input value={f.titulo || ""} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></Field>
            <Field label="WhatsApp de atendimento"><Input value={f.whatsapp || ""} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="Vazio = o da empresa" /></Field>
          </Grid>
          <Field label="Apresentação"><Textarea value={f.descricao || ""} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Impressão 3D sob encomenda em PLA, PETG e resina…" /></Field>
          <Grid>
            <Field label="Prazo informado ao cliente"><Input value={f.prazo_texto || ""} onChange={(e) => setF({ ...f, prazo_texto: e.target.value })} placeholder="Produção em até 5 dias úteis" /></Field>
            <Field label="Cores oferecidas" hint="Separadas por vírgula"><Input value={f.cores || ""} onChange={(e) => setF({ ...f, cores: e.target.value })} /></Field>
          </Grid>
          <Field label="Mensagem depois do envio"><Input value={f.mensagem_sucesso || ""} onChange={(e) => setF({ ...f, mensagem_sucesso: e.target.value })} placeholder="Respondemos em até 1 dia útil" /></Field>
          <div className="space-y-2"><Checkbox label="Mostrar preços dos produtos" checked={f.mostrar_precos} onChange={(v) => setF({ ...f, mostrar_precos: v })} />
            <Checkbox label="Aceitar arquivos STL/3MF/OBJ/STEP" hint="Até 5 arquivos de 50 MB por pedido; contam no espaço do seu plano" checked={f.aceitar_arquivos} onChange={(v) => setF({ ...f, aceitar_arquivos: v })} /></div>
          <div><div className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">Materiais que o comprador pode escolher</div>
            {!dados ? <Loading /> : !dados.mats.length ? <p className="text-sm text-slate-500">Cadastre filamentos/resinas em Matéria-prima.</p> :
              <div className="grid gap-1.5 sm:grid-cols-2">{dados.mats.map((m) => <Checkbox key={m.id} label={`${m.nome}${m.cor ? ` · ${m.cor}` : ""}`} checked={f.materiais_ids.includes(m.id)}
                onChange={(v) => setF({ ...f, materiais_ids: v ? [...f.materiais_ids, m.id] : f.materiais_ids.filter((x) => x !== m.id) })} />)}</div>}</div>
          <div className="flex justify-end"><Button type="submit" loading={salvando}>Salvar</Button></div>
        </form>
      </Card>
      <Card><CardTitle>Produtos na loja</CardTitle>
        {!dados ? <Loading /> : !dados.prods.length ? <Empty texto="Nenhum produto ativo" /> : (
          <div className="space-y-2">{dados.prods.map((p) => <Checkbox key={p.id} label={p.nome} hint={`${brl(p.preco_venda)}${p.foto_path ? "" : " · sem foto"}`} checked={p.no_portal}
            onChange={async (v) => { await alternarProduto(p.id, v); p.no_portal = v; setF({ ...f }); }} />)}</div>)}
        <p className="mt-3 text-xs text-slate-500">Custos e ficha técnica nunca aparecem para o comprador. Fotos dos produtos marcados ficam visíveis enquanto o portal estiver ativo.</p>
        <p className="mt-2 text-xs text-slate-500">Login próprio para compradores e domínio personalizado ficam para uma próxima etapa: hoje o comprador acompanha tudo por um link secreto.</p>
      </Card>
    </div>
  );
}
