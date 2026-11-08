"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc } from "@/lib/supabase";
import { brl, data, dataHora, STATUS_EMPRESA, STATUS_ASSINATURA } from "@/lib/utils";
import { PageHeader } from "@/components/shell";
import { Badge, Card, Empty, ErrorBox, Input, Loading, Paginacao, Select, Table, Td, tomStatus } from "@/components/ui";
import { EmpresaDetalhe, type Empresa } from "./detalhe";

const POR_PAGINA = 20;

export default function Empresas() {
  const [lista, setLista] = useState<Empresa[] | null>(null);
  const [erro, setErro] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [ordem, setOrdem] = useState("recentes");
  const [pagina, setPagina] = useState(1);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("q");
    if (p) setQ(p);
  }, []);

  const carregar = useCallback(async () => {
    setErro("");
    try { setLista(await rpc<Empresa[]>("admin_empresas")); } catch (e) { setErro((e as Error).message); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrada = useMemo(() => {
    if (!lista) return [];
    const t = q.trim().toLowerCase();
    let r = lista.filter((e) => (!status || e.status === status) &&
      (!t || [e.nome, e.razao_social, e.documento, e.dono, e.email].some((v) => (v || "").toLowerCase().includes(t))));
    if (ordem === "nome") r = [...r].sort((a, b) => a.nome.localeCompare(b.nome));
    if (ordem === "acesso") r = [...r].sort((a, b) => (b.ultimo_acesso || "").localeCompare(a.ultimo_acesso || ""));
    return r;
  }, [lista, q, status, ordem]);

  useEffect(() => setPagina(1), [q, status, ordem]);
  const pag = filtrada.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  return (
    <>
      <PageHeader titulo="Empresas" sub="Assinantes da plataforma" />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Input placeholder="Buscar por nome, CNPJ/CPF ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(STATUS_EMPRESA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
            <option value="recentes">Mais recentes</option><option value="nome">Nome</option><option value="acesso">Último acesso</option>
          </Select>
        </div>
        {erro && <ErrorBox erro={erro} onRetry={carregar} />}
        {!lista && !erro && <Loading />}
        {lista && !filtrada.length && <Empty texto="Nenhuma empresa encontrada." />}
        {!!pag.length && (
          <Table head={["Empresa", "Status", "Plano", "Próxima cobrança", "Usuários", "Último acesso", "Cadastro"]}>
            {pag.map((e) => (
              <tr key={e.id} onClick={() => setAberta(e.id)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Td><div className="font-medium">{e.nome}</div><div className="text-xs text-slate-500">{e.dono || e.email || "—"}</div></Td>
                <Td><Badge tom={tomStatus(e.status)}>{STATUS_EMPRESA[e.status]}</Badge></Td>
                <Td>{e.assinatura ? <><div>{e.assinatura.plano}</div><div className="text-xs text-slate-500">{brl(e.assinatura.valor)} · <span>{STATUS_ASSINATURA[e.assinatura.status]}</span></div></> : "—"}</Td>
                <Td className="tnum">{data(e.assinatura?.proxima_cobranca)}</Td>
                <Td className="tnum">{e.usuarios}</Td>
                <Td className="whitespace-nowrap">{dataHora(e.ultimo_acesso)}</Td>
                <Td className="whitespace-nowrap">{data(e.criado_em)}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Paginacao pagina={pagina} total={filtrada.length} porPagina={POR_PAGINA} onChange={setPagina} />
      </Card>
      {aberta && lista && (
        <EmpresaDetalhe empresa={lista.find((x) => x.id === aberta)!} onClose={() => setAberta(null)} onChange={carregar} />
      )}
    </>
  );
}
