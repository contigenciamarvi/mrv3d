"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Cloud, Plug, Download, KeyRound, ShieldCheck, Ban, Copy, Printer } from "lucide-react";
import { useApp, PageHeader } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { dataHora, cn } from "@/lib/utils";
import { Button, Card, CardTitle, Field, Input, Select, Table, Td, Loading, ErrorBox, Empty, Badge, Aviso, Tabs, Confirmar } from "@/components/ui";
import { Biblioteca, Importador, MakerWorld } from "@/components/projetos";

type Aba = "conta" | "impressoras" | "projetos" | "importar" | "makerworld" | "historico" | "config";
type Agente = { id: string; nome: string; ativo: boolean; versao: string | null; maquina: string | null; sistema: string | null; ultimo_contato: string | null; dispositivos_detectados: { dispositivo_id: string; tipo_conexao: string; nome: string | null }[]; created_at: string; revogado_em: string | null; revogado_por: string | null };
const TIPO_EV: Record<string, string> = { importacao: "Importação", atualizacao: "Atualização", exclusao: "Exclusão", erro: "Erro", duplicado: "Duplicado", vinculo: "Vínculo", conexao: "Conexão", desconexao: "Desconexão", agente: "Agente" };

export default function BambuLab() {
  const app = useApp();
  const abaUrl = useParam("aba");
  const [aba, setAba] = useState<Aba>("conta");
  useEffect(() => { if (abaUrl) setAba(abaUrl as Aba); }, [abaUrl]);
  const admin = app.pode("integracoes_config");
  const verProj = app.pode("produtos_ver") || app.pode("orcamentos_criar") || app.pode("producao_gerenciar");
  const abas: [Aba, string][] = [["conta", "Minha conta"], ["impressoras", "Minhas impressoras"], ...(verProj ? [["projetos", "Meus projetos"], ["importar", "Importar STL / 3MF"], ["makerworld", "MakerWorld"]] as [Aba, string][] : []),
    ...((admin || app.pode("produtos_ver")) ? [["historico", "Histórico de sincronização"]] as [Aba, string][] : []), ...(admin ? [["config", "Configurações"]] as [Aba, string][] : [])];
  return (
    <>
      <PageHeader titulo="Integrações › Bambu Lab" sub="Projetos do Bambu Studio e do MakerWorld, e impressoras Bambu Lab na rede da loja" />
      <Tabs abas={abas} ativa={aba} onChange={setAba} />
      {aba === "conta" && <Conta />}
      {aba === "impressoras" && <Impressoras />}
      {aba === "projetos" && <Biblioteca />}
      {aba === "importar" && <Importador onPronto={() => setAba("projetos")} />}
      {aba === "makerworld" && <MakerWorld />}
      {aba === "historico" && <Historico />}
      {aba === "config" && <Config />}
    </>
  );
}

function Conta() {
  const app = useApp();
  const [desc, setDesc] = useState(false);
  const { dados, recarregar } = useDados(async () => {
    const [[i]] = await Promise.all([q<{ status: string; modo: string; ultima_sincronizacao: string | null; ultimo_erro: string | null }[]>(sb().from("integracoes").select("status,modo,ultima_sincronizacao,ultimo_erro").eq("empresa_id", app.empresa.id).eq("provedor", "bambu_lab"))]);
    return i || null;
  }, [app.empresa.id]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardTitle><span className="flex items-center gap-2"><Cloud className="h-5 w-5 text-slate-400" /> Conta Bambu Lab (nuvem)</span></CardTitle>
        <Badge tom="cinza">Não disponível</Badge>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">A Bambu Lab não oferece hoje uma API pública com login autorizado (OAuth) para sistemas de terceiros. Os caminhos oficiais são o Bambu Connect, o Modo Desenvolvedor na rede local e o SDK do Local Server, liberado mediante parceria. Por isso <b>não pedimos nem guardamos a senha da sua conta</b> e não usamos APIs privadas.</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Quando houver autorização oficial, a sincronização de projetos e impressoras da conta entra aqui. Os tokens serão guardados criptografados e isolados por empresa.</p>
        <ul className="mt-3 space-y-1 text-sm"><li className="flex gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> O que já funciona: biblioteca de projetos com importação manual, orçamento automático e monitoramento pela rede local com o agente.</li></ul>
      </Card>
      <Card><CardTitle><span className="flex items-center gap-2"><Plug className="h-5 w-5 text-slate-400" /> Rede local (agente)</span></CardTitle>
        {!dados ? <Loading /> : <>
          <Badge tom={dados?.status === "conectada" ? "verde" : dados?.status === "desconectada" ? "cinza" : "amarelo"}>{dados?.status === "conectada" ? "Conectada" : dados?.status === "desconectada" ? "Desconectada" : "Não configurada"}</Badge>
          {dados?.ultima_sincronizacao && <p className="mt-2 text-sm text-slate-500">Última leitura {dataHora(dados.ultima_sincronizacao)}</p>}
          {dados?.ultimo_erro && <Aviso tom="vermelho">{dados.ultimo_erro}</Aviso>}
        </>}
        {dados === null && <Badge tom="cinza">Não configurada</Badge>}
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">O agente roda num computador da loja e lê as impressoras pela rede (somente leitura). O código de acesso LAN fica só nesse computador.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {app.pode("integracoes_config") && <Link href="/integracoes/bambu/?aba=config"><Button variant="secondary">Configurar agente</Button></Link>}
          {app.pode("integracoes_config") && app.podeEscrever && <Button variant="ghost" onClick={() => setDesc(true)}>Desconectar e excluir credenciais</Button>}
        </div>
      </Card>
      <Confirmar aberto={desc} titulo="Desconectar Bambu Lab" perigo confirmar="Desconectar" onCancel={() => setDesc(false)}
        texto="Exclui as credenciais guardadas, tira as impressoras Bambu Lab do monitoramento, limpa o estado atual e revoga todos os agentes locais da empresa (as impressoras Klipper/OctoPrint ligadas a eles também param de enviar dados até você parear de novo). No computador do agente, apague a pasta de configuração para remover os códigos de acesso LAN. A biblioteca de projetos e o histórico continuam."
        onOk={async () => { try { await rpc("desconectar_integracao", { p_empresa: app.empresa.id, p_provedor: "bambu_lab" }); toast("Integração desconectada"); setDesc(false); recarregar(); } catch (e) { erro(e); } }} />
    </div>
  );
}

function Impressoras() {
  const app = useApp();
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<{ id: string; nome: string; fabricante: string | null; modelo: string | null; status: string; conexao_tipo: string; dispositivo_id: string | null }[]>(
    sb().from("impressoras").select("id,nome,fabricante,modelo,status,conexao_tipo,dispositivo_id").eq("empresa_id", app.empresa.id).neq("status", "inativa").order("nome")), [app.empresa.id]);
  const bambu = (dados || []).filter((i) => i.conexao_tipo === "bambu_lan" || /bambu/i.test(`${i.fabricante} ${i.modelo} ${i.nome}`));
  return (
    <Card><CardTitle right={<Link href="/impressoras/monitoramento/"><Button size="sm" variant="secondary"><Printer className="h-4 w-4" /> Monitoramento</Button></Link>}>Impressoras Bambu Lab</CardTitle>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !bambu.length ? <Empty texto="Nenhuma impressora Bambu Lab cadastrada. Cadastre em Impressoras 3D (fabricante Bambu Lab)." /> : (
        <Table head={["Impressora", "Modelo", "Número de série", "Monitoramento"]}>{bambu.map((i) => (
          <tr key={i.id}><Td className="font-medium">{i.nome}</Td><Td>{i.modelo || "—"}</Td><Td className="font-mono text-xs">{i.dispositivo_id || "—"}</Td>
            <Td>{i.conexao_tipo === "bambu_lan" ? <Badge tom="verde">Ligada ao agente</Badge> : <Link className="text-sm text-brand-700 underline" href="/impressoras/monitoramento/">Conectar</Link>}</Td></tr>))}</Table>)}
      <p className="mt-3 text-xs text-slate-500">Sincronização de impressoras da conta Bambu (nuvem): não disponível sem autorização oficial. A lista vem do seu cadastro e do agente local.</p>
    </Card>
  );
}

function Historico() {
  const app = useApp();
  const [tipo, setTipo] = useState("");
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<{ id: number; tipo: string; mensagem: string; created_at: string }[]>(
    sb().from("integracao_eventos").select("id,tipo,mensagem,created_at").eq("empresa_id", app.empresa.id).order("id", { ascending: false }).limit(500)), [app.empresa.id]);
  const lista = (dados || []).filter((e) => !tipo || e.tipo === tipo);
  return (
    <Card><CardTitle right={<Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-48" aria-label="Tipo"><option value="">Todos</option>{Object.entries(TIPO_EV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>Histórico de importações, atualizações e erros</CardTitle>
      {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !lista.length ? <Empty texto="Nada registrado ainda" /> : (
        <Table head={["Quando", "Tipo", "Descrição"]}>{lista.map((e) => (
          <tr key={e.id}><Td className="whitespace-nowrap text-sm">{dataHora(e.created_at)}</Td><Td><Badge tom={e.tipo === "erro" ? "vermelho" : e.tipo === "duplicado" ? "amarelo" : e.tipo === "importacao" ? "verde" : "cinza"}>{TIPO_EV[e.tipo] || e.tipo}</Badge></Td><Td className="text-sm">{e.mensagem}</Td></tr>))}</Table>)}
      <p className="mt-3 text-xs text-slate-500">Eventos das impressoras (conexão, impressões, falhas) ficam em Impressoras › Monitoramento.</p>
    </Card>
  );
}

function Config() {
  const app = useApp();
  const [nome, setNome] = useState("PC da oficina");
  const [codigo, setCodigo] = useState<{ codigo: string; expira_em: string } | null>(null);
  const [revogar, setRevogar] = useState<Agente | null>(null);
  const site = typeof window !== "undefined" ? window.location.origin : "";
  const { dados, carregando, erro: falha, recarregar } = useDados(() => q<Agente[]>(sb().from("agentes_locais").select("id,nome,ativo,versao,maquina,sistema,ultimo_contato,dispositivos_detectados,created_at,revogado_em,revogado_por")
    .eq("empresa_id", app.empresa.id).order("created_at", { ascending: false })), [app.empresa.id]);
  useEffect(() => { if (!codigo) return; const t = setInterval(recarregar, 5000); return () => clearInterval(t); }, [codigo, recarregar]);
  const online = (a: Agente) => a.ultimo_contato && Date.now() - new Date(a.ultimo_contato).getTime() < 120000;
  const cmd = codigo ? `python3 mrv3d_agente.py parear ${codigo.codigo} --site ${site}` : "";
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardTitle>1. Baixe o agente</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">Programa leve em Python para Windows, Linux ou Raspberry Pi. Só leitura: não pausa, não cancela, não envia impressões. Não abre portas no roteador.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/agente/mrv3d_agente.py" download><Button><Download className="h-4 w-4" /> mrv3d_agente.py</Button></a>
            <a href="/agente/guia-conectar-impressora.pdf" target="_blank" rel="noreferrer"><Button variant="secondary">Guia passo a passo (PDF)</Button></a>
            <a href="/agente/LEIAME.txt" target="_blank" rel="noreferrer"><Button variant="ghost">LEIAME</Button></a>
            <a href="/agente/mrv3d_agente.py.sha256" target="_blank" rel="noreferrer"><Button variant="ghost">SHA-256</Button></a>
          </div>
          <p className="mt-2 text-xs text-slate-500">Para Bambu Lab: <code>pip install paho-mqtt</code>. Confira o download pela soma SHA-256.</p>
        </Card>
        <Card><CardTitle>2. Pareie com um código temporário</CardTitle>
          {!codigo ? <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); try { setCodigo(await rpc("criar_pareamento", { p_empresa: app.empresa.id, p_nome: nome })); recarregar(); } catch (e2) { erro(e2); } }}>
            <Field label="Nome do agente" hint="Ex.: computador onde ele vai rodar"><Input required value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
            <Button type="submit" disabled={!app.podeEscrever}><KeyRound className="h-4 w-4" /> Gerar código</Button>
          </form> : <div className="space-y-3">
            <div className="rounded-lg bg-slate-100 p-4 text-center font-mono text-3xl font-bold tracking-widest dark:bg-slate-800">{codigo.codigo}</div>
            <p className="text-center text-xs text-slate-500">Vale até {new Date(codigo.expira_em).toLocaleTimeString("pt-BR")} e só pode ser usado uma vez.</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{cmd}</pre>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { navigator.clipboard.writeText(cmd); toast("Comando copiado"); }}><Copy className="h-4 w-4" /> Copiar comando</Button>
              <Button size="sm" variant="ghost" onClick={() => setCodigo(null)}>Gerar outro</Button></div>
            <p className="text-xs text-slate-500">O token permanente é criado direto no agente: ele nunca aparece no navegador.</p>
          </div>}
        </Card>
      </div>
      <Card><CardTitle>Agentes</CardTitle>
        {falha ? <ErrorBox erro={falha} onRetry={recarregar} /> : carregando && !dados ? <Loading /> : !dados?.length ? <Empty texto="Nenhum agente pareado" /> : (
          <Table head={["Agente", "Computador", "Versão", "Último contato", "Situação", "Encontradas", ""]}>{dados.map((a) => (
            <tr key={a.id} className={cn(!a.ativo && "opacity-50")}><Td className="font-medium">{a.nome}</Td><Td className="text-sm">{[a.maquina, a.sistema].filter(Boolean).join(" · ") || "—"}</Td><Td>{a.versao || "—"}</Td>
              <Td className="text-sm">{dataHora(a.ultimo_contato)}</Td>
              <Td>{!a.ativo ? <Badge>{a.revogado_por === "plataforma" ? "Revogado pela plataforma" : "Revogado"}</Badge> : online(a) ? <Badge tom="verde">Online</Badge> : a.ultimo_contato ? <Badge tom="amarelo">Offline</Badge> : <Badge tom="cinza">Nunca conectou</Badge>}</Td>
              <Td className="text-sm">{a.dispositivos_detectados.length ? <Link className="text-brand-700 underline" href="/impressoras/monitoramento/">{a.dispositivos_detectados.length} não ligada(s)</Link> : "—"}</Td>
              <Td>{a.ativo && app.podeEscrever && <Button size="sm" variant="ghost" onClick={() => setRevogar(a)}><Ban className="h-4 w-4" /> Revogar</Button>}</Td></tr>))}</Table>)}
        <p className="mt-3 text-xs text-slate-500">Revogar invalida a credencial do agente na hora. Para usar de novo, gere outro código.</p>
      </Card>
      <Confirmar aberto={!!revogar} titulo="Revogar agente" perigo confirmar="Revogar" onCancel={() => setRevogar(null)} texto={`O agente "${revogar?.nome}" para de enviar dados imediatamente.`}
        onOk={async () => { try { await rpc("revogar_agente", { p_id: revogar!.id }); toast("Agente revogado"); setRevogar(null); recarregar(); } catch (e) { erro(e); } }} />
    </div>
  );
}
