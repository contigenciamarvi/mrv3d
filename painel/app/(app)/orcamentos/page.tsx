"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Copy } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q, rpc } from "@/lib/supabase";
import { useDados } from "@/lib/hooks";
import { erro } from "@/lib/toast";
import { brl, data, hojeISO, STATUS_ORCAMENTO } from "@/lib/utils";
import { Button, Card, Input, Select, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Kpi, Paginacao } from "@/components/ui";

type Orc = { id: string; numero: number; titulo: string; status: string; total: number; lucro_estimado: number; validade: string | null; created_at: string; respondido_em: string | null; clientes: { nome: string } | null };

export default function Orcamentos() { return <Exige perm={["orcamentos_ver", "orcamentos_criar"]}><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const router = useRouter();
  const pode = app.pode("orcamentos_criar") && app.podeEscrever;
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [pagina, setPagina] = useState(1);
  const { dados, carregando, erro: falha, recarregar } = useDados(() =>
    q<Orc[]>(sb().from("orcamentos").select("id,numero,titulo,status,total,lucro_estimado,validade,created_at,respondido_em,clientes(nome)").eq("empresa_id", app.empresa.id).order("created_at", { ascending: false }).limit(2000)), [app.empresa.id]);
  const hoje = hojeISO();
  const exp = (o: Orc) => o.status === "enviado" && !!o.validade && o.validade < hoje;
  const lista = useMemo(() => (dados || []).filter((o) => {
    const st = exp(o) ? "expirado" : o.status;
    const t = busca.trim().toLowerCase();
    return (!status || st === status) && (!t || o.titulo.toLowerCase().includes(t) || String(o.numero) === t || o.clientes?.nome.toLowerCase().includes(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dados, busca, status]);
  const enviados = (dados || []).filter((o) => o.status !== "rascunho" && o.status !== "cancelado");
  const aprovados = enviados.filter((o) => ["aprovado", "convertido"].includes(o.status));
  const conv = enviados.length ? Math.round((aprovados.length / enviados.length) * 100) : 0;

  return (
    <>
      <PageHeader titulo="Orçamentos" sub="Calculadora de impressão 3D, aprovação por link e conversão em pedido"
        acoes={pode && <><Link href="/orcamentos/importar/"><Button variant="secondary">Importar Bambu Studio</Button></Link><Link href="/orcamentos/editar/"><Button><Plus className="h-4 w-4" /> Novo orçamento</Button></Link></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Aguardando resposta" valor={(dados || []).filter((o) => o.status === "enviado" && !exp(o)).length} />
        <Kpi label="Aprovados (total)" valor={aprovados.length} />
        <Kpi label="Taxa de conversão" valor={`${conv}%`} sub="Aprovados ÷ enviados" />
        <Kpi label="Valor em aberto" valor={brl((dados || []).filter((o) => o.status === "enviado" && !exp(o)).reduce((s, o) => s + o.total, 0))} />
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input placeholder="Buscar por número, título ou cliente" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} className="min-w-60 flex-1" aria-label="Buscar" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="w-44" aria-label="Situação"><option value="">Todas as situações</option>
            {Object.entries(STATUS_ORCAMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="expirado">Vencido</option></Select>
        </div>
        {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
        {carregando && !dados ? <Loading /> : lista.length === 0 ? <Empty texto="Nenhum orçamento" /> : (
          <>
            <Table head={["Nº", "Título", "Cliente", "Criado", "Validade", "Situação", "Total", app.pode("custos_ver") ? "Lucro est." : "", ""]}>
              {lista.slice((pagina - 1) * 25, pagina * 25).map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => router.push(`/orcamentos/editar/?id=${o.id}`)}>
                  <Td className="tnum font-medium">{app.config.prefixo_orcamento}-{o.numero}</Td><Td>{o.titulo}</Td><Td>{o.clientes?.nome || "—"}</Td><Td>{data(o.created_at)}</Td>
                  <Td className={exp(o) ? "text-red-600" : ""}>{data(o.validade)}</Td>
                  <Td>{exp(o) ? <Badge tom="vermelho">Vencido</Badge> : <Badge tom={tomStatus(o.status)}>{STATUS_ORCAMENTO[o.status]}</Badge>}</Td>
                  <Td className="tnum font-medium">{brl(o.total)}</Td><Td className="tnum text-slate-500">{app.pode("custos_ver") ? brl(o.lucro_estimado) : ""}</Td>
                  <Td>{pode && <button title="Duplicar" aria-label="Duplicar" onClick={async (e) => { e.stopPropagation(); try { const id = await rpc<string>("duplicar_orcamento", { p_id: o.id }); router.push(`/orcamentos/editar/?id=${id}`); } catch (e2) { erro(e2); } }}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Copy className="h-4 w-4" /></button>}</Td>
                </tr>
              ))}
            </Table>
            <Paginacao pagina={pagina} total={lista.length} porPagina={25} onChange={setPagina} />
          </>
        )}
      </Card>
    </>
  );
}
