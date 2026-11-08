"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { dataHora, pode, PAPEIS } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, Modal, Paginacao, Select, Table, Td } from "@/components/ui";

type Usuario = { id: string; email: string; criado_em: string; confirmado: boolean; ultimo_acesso: string | null; bloqueado: boolean; equipe: string | null; empresas: { id: string; nome: string; papel: string }[] };
type Membro = { user_id: string; nome: string | null; email: string; papel: string; ativo: boolean; ultimo_acesso: string | null; desde: string };

export default function Usuarios() {
  const { papel, userId } = useSessao();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [equipe, setEquipe] = useState<Membro[] | null>(null);
  const [erroTxt, setErro] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState(false);
  const [confirmar, setConfirmar] = useState<Usuario | null>(null);

  const carregar = useCallback(async () => {
    setErro("");
    try {
      const [u, e] = await Promise.all([rpc<Usuario[]>("admin_usuarios", { p_busca: null }), rpc<Membro[]>("admin_equipe")]);
      setLista(u); setEquipe(e);
    } catch (x) { setErro((x as Error).message); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrada = useMemo(() => (lista || []).filter((u) => !q || u.email.toLowerCase().includes(q.toLowerCase()) || u.empresas.some((e) => e.nome.toLowerCase().includes(q.toLowerCase()))), [lista, q]);
  useEffect(() => setPagina(1), [q]);

  const bloquear = async (u: Usuario) => {
    try { await rpc("admin_bloquear_usuario", { p_user: u.id, p_bloquear: !u.bloqueado }); toast(u.bloqueado ? "Acesso liberado" : "Usuário bloqueado"); carregar(); }
    catch (x) { erro(x); } finally { setConfirmar(null); }
  };

  return (
    <>
      <PageHeader titulo="Usuários" sub="Contas da plataforma e equipe administrativa" />
      {erroTxt && <ErrorBox erro={erroTxt} onRetry={carregar} />}
      <div className="space-y-6">
        <Card>
          <CardTitle right={pode(papel, "gerirEquipe") && <Button size="sm" onClick={() => setNovo(true)}>Adicionar à equipe</Button>}>Equipe do Super Admin</CardTitle>
          {!equipe ? <Loading /> : (
            <Table head={["Pessoa", "Perfil", "Situação", "Último acesso", ""]}>
              {equipe.map((m) => (
                <tr key={m.user_id}>
                  <Td><div className="font-medium">{m.nome || m.email}</div><div className="text-xs text-slate-500">{m.email}</div></Td>
                  <Td>{PAPEIS[m.papel]}</Td>
                  <Td>{m.ativo ? <Badge tom="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                  <Td className="whitespace-nowrap">{dataHora(m.ultimo_acesso)}</Td>
                  <Td>{pode(papel, "gerirEquipe") && m.user_id !== userId && <EquipeAcoes m={m} onChange={carregar} />}</Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Autenticação em dois fatores para administradores entra na próxima fase.</p>
        </Card>

        <Card>
          <CardTitle>Todas as contas</CardTitle>
          <Input className="mb-4" placeholder="Buscar por e-mail ou empresa" value={q} onChange={(e) => setQ(e.target.value)} />
          {!lista ? <Loading /> : !filtrada.length ? <Empty texto="Nenhum usuário encontrado." /> : (
            <Table head={["E-mail", "Empresas", "Cadastro", "Último acesso", "Situação", ""]}>
              {filtrada.slice((pagina - 1) * 25, pagina * 25).map((u) => (
                <tr key={u.id}>
                  <Td><div className="font-medium">{u.email}</div>{u.equipe && <div className="text-xs text-brand-600">{PAPEIS[u.equipe]}</div>}</Td>
                  <Td>{u.empresas.length ? u.empresas.map((e) => <div key={e.id}>{e.nome} <span className="text-xs text-slate-500">({e.papel})</span></div>) : <span className="text-slate-400">—</span>}</Td>
                  <Td className="whitespace-nowrap">{dataHora(u.criado_em)}</Td>
                  <Td className="whitespace-nowrap">{dataHora(u.ultimo_acesso)}</Td>
                  <Td>{u.bloqueado ? <Badge tom="vermelho">Bloqueado</Badge> : u.confirmado ? <Badge tom="verde">Ativo</Badge> : <Badge tom="amarelo">E-mail não confirmado</Badge>}</Td>
                  <Td>{pode(papel, "bloquearUsuario") && u.id !== userId && <Button size="sm" variant="secondary" onClick={() => setConfirmar(u)}>{u.bloqueado ? "Desbloquear" : "Bloquear"}</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
          <Paginacao pagina={pagina} total={filtrada.length} porPagina={25} onChange={setPagina} />
        </Card>
      </div>

      <NovoMembro aberto={novo} onClose={() => setNovo(false)} onOk={carregar} souProprietario={papel === "proprietario"} />
      <Modal aberto={!!confirmar} titulo={confirmar?.bloqueado ? "Desbloquear usuário" : "Bloquear usuário"} onClose={() => setConfirmar(null)}>
        <p className="mb-4 text-sm">{confirmar?.bloqueado ? `Liberar o acesso de ${confirmar?.email}?` : `Bloquear ${confirmar?.email}? A pessoa não conseguirá mais entrar até ser desbloqueada.`}</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmar(null)}>Voltar</Button>
          <Button variant={confirmar?.bloqueado ? "primary" : "danger"} onClick={() => bloquear(confirmar!)}>Confirmar</Button></div>
      </Modal>
    </>
  );
}

function EquipeAcoes({ m, onChange }: { m: Membro; onChange: () => void }) {
  const [p, setP] = useState(m.papel);
  const salvar = async (novoPapel: string) => {
    setP(novoPapel);
    try { await rpc("admin_adicionar_equipe", { p_email: m.email, p_papel: novoPapel, p_nome: m.nome }); toast("Perfil atualizado"); onChange(); } catch (x) { erro(x); setP(m.papel); }
  };
  return (
    <Select value={p} onChange={(e) => salvar(e.target.value)} className="h-8 w-auto text-xs" aria-label="Perfil">
      {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </Select>
  );
}

function NovoMembro({ aberto, onClose, onOk, souProprietario }: { aberto: boolean; onClose: () => void; onOk: () => void; souProprietario: boolean }) {
  const [email, setEmail] = useState(""); const [nome, setNome] = useState(""); const [papel, setPapel] = useState("suporte");
  const [salvando, setSalvando] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { await rpc("admin_adicionar_equipe", { p_email: email, p_papel: papel, p_nome: nome }); toast("Pessoa adicionada à equipe"); setEmail(""); setNome(""); onOk(); onClose(); }
    catch (x) { erro(x); } finally { setSalvando(false); }
  };
  return (
    <Modal aberto={aberto} titulo="Adicionar à equipe" onClose={onClose}>
      <form onSubmit={salvar} className="space-y-3">
        <p className="text-sm text-slate-500">A pessoa precisa já ter uma conta criada no sistema com esse e-mail.</p>
        <Field label="E-mail"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Perfil"><Select value={papel} onChange={(e) => setPapel(e.target.value)}>
          {Object.entries(PAPEIS).filter(([k]) => k !== "proprietario" || souProprietario).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}>Adicionar</Button></div>
      </form>
    </Modal>
  );
}
