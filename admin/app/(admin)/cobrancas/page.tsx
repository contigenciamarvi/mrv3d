"use client";
import { useCallback, useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { sb } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { brl, data, dataHora, pode, STATUS_FATURA } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Badge, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, Modal, Select, Table, Td, tomStatus } from "@/components/ui";

type Fatura = { id: string; descricao: string | null; valor: number; vencimento: string; status: string; valor_pago: number | null; pago_em: string | null; metodo: string | null; empresas: { nome: string } | null };
type Cupom = { id: string; codigo: string; desconto_percentual: number | null; desconto_valor: number | null; valido_ate: string | null; usos_max: number | null; usos: number; ativo: boolean };

export default function Cobrancas() {
  const { papel } = useSessao();
  const [faturas, setFaturas] = useState<Fatura[] | null>(null);
  const [cupons, setCupons] = useState<Cupom[] | null>(null);
  const [erroTxt, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [novoCupom, setNovoCupom] = useState(false);

  const carregar = useCallback(async () => {
    setErro("");
    const f = await sb().from("faturas").select("id,descricao,valor,vencimento,status,valor_pago,pago_em,metodo,empresas(nome)").order("vencimento", { ascending: false }).limit(500);
    if (f.error) return setErro(f.error.message);
    setFaturas(f.data as unknown as Fatura[]);
    if (pode(papel, "gerirCobrancas")) {
      const c = await sb().from("cupons").select("*").order("created_at", { ascending: false });
      if (!c.error) setCupons(c.data as Cupom[]);
    }
  }, [papel]);
  useEffect(() => { carregar(); }, [carregar]);

  const alternarCupom = async (c: Cupom) => {
    const { error } = await sb().from("cupons").update({ ativo: !c.ativo }).eq("id", c.id);
    if (error) return erro(error);
    toast(c.ativo ? "Cupom desativado" : "Cupom ativado"); carregar();
  };

  const lista = (faturas || []).filter((x) => !filtro || x.status === filtro);
  return (
    <>
      <PageHeader titulo="Cobranças" sub="Faturas das assinaturas e cupons" />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
        <div><b>Gateway de pagamento ainda não integrado.</b> A estrutura de faturas, eventos e webhooks já existe no banco. Para cobrar automaticamente (Pix, boleto e cartão) é preciso escolher o gateway (Asaas, Mercado Pago ou Stripe) e informar a chave de API e o segredo do webhook. Nenhum pagamento é simulado.</div>
      </div>
      {erroTxt && <ErrorBox erro={erroTxt} onRetry={carregar} />}
      <div className="space-y-6">
        <Card>
          <CardTitle right={<Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-auto" aria-label="Status">
            <option value="">Todos os status</option>{Object.entries(STATUS_FATURA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}>Faturas</CardTitle>
          {!faturas ? <Loading /> : !lista.length ? <Empty texto="Nenhuma fatura ainda." /> : (
            <Table head={["Empresa", "Descrição", "Vencimento", "Valor", "Status", "Pago em", "Método"]}>
              {lista.map((x) => (
                <tr key={x.id}><Td className="font-medium">{x.empresas?.nome}</Td><Td>{x.descricao || "Assinatura"}</Td><Td className="tnum">{data(x.vencimento)}</Td>
                  <Td className="tnum">{brl(x.valor)}</Td><Td><Badge tom={tomStatus(x.status)}>{STATUS_FATURA[x.status]}</Badge></Td>
                  <Td className="whitespace-nowrap">{dataHora(x.pago_em)}</Td><Td>{x.metodo || "—"}</Td></tr>
              ))}
            </Table>
          )}
        </Card>

        {pode(papel, "gerirCobrancas") && (
          <Card>
            <CardTitle right={<Button size="sm" onClick={() => setNovoCupom(true)}>Novo cupom</Button>}>Cupons de desconto</CardTitle>
            {!cupons ? <Loading /> : !cupons.length ? <Empty texto="Nenhum cupom criado." /> : (
              <Table head={["Código", "Desconto", "Validade", "Usos", "Situação", ""]}>
                {cupons.map((c) => (
                  <tr key={c.id}><Td className="font-mono font-medium">{c.codigo}</Td>
                    <Td>{c.desconto_percentual != null ? `${c.desconto_percentual}%` : brl(c.desconto_valor)}</Td>
                    <Td>{data(c.valido_ate)}</Td><Td className="tnum">{c.usos}{c.usos_max ? ` / ${c.usos_max}` : ""}</Td>
                    <Td>{c.ativo ? <Badge tom="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                    <Td><Button size="sm" variant="secondary" onClick={() => alternarCupom(c)}>{c.ativo ? "Desativar" : "Ativar"}</Button></Td></tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
      <NovoCupom aberto={novoCupom} onClose={() => setNovoCupom(false)} onOk={carregar} />
    </>
  );
}

function NovoCupom({ aberto, onClose, onOk }: { aberto: boolean; onClose: () => void; onOk: () => void }) {
  const [codigo, setCodigo] = useState(""); const [tipo, setTipo] = useState("percentual"); const [valor, setValor] = useState("");
  const [validade, setValidade] = useState(""); const [usos, setUsos] = useState(""); const [salvando, setSalvando] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const cod = codigo.trim().toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9_-]{3,40}$/.test(cod)) return toast("Código: 3 a 40 letras, números, _ ou -", "erro");
    const v = Number(valor);
    if (!(v > 0) || (tipo === "percentual" && v > 100)) return toast("Valor de desconto inválido", "erro");
    setSalvando(true);
    const { error } = await sb().from("cupons").insert({
      codigo: cod, desconto_percentual: tipo === "percentual" ? v : null, desconto_valor: tipo === "valor" ? v : null,
      valido_ate: validade || null, usos_max: usos ? Number(usos) : null,
    });
    setSalvando(false);
    if (error) return erro(/duplicate/i.test(error.message) ? new Error("Já existe um cupom com esse código") : error);
    toast("Cupom criado"); setCodigo(""); setValor(""); setValidade(""); setUsos(""); onOk(); onClose();
  };
  return (
    <Modal aberto={aberto} titulo="Novo cupom" onClose={onClose}>
      <form onSubmit={salvar} className="space-y-3">
        <Field label="Código"><Input required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="BEMVINDO10" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo"><Select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="percentual">Percentual (%)</option><option value="valor">Valor fixo (R$)</option></Select></Field>
          <Field label="Desconto"><Input type="number" step="0.01" min={0} required value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
          <Field label="Válido até (opcional)"><Input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></Field>
          <Field label="Limite de usos (opcional)"><Input type="number" min={1} value={usos} onChange={(e) => setUsos(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" loading={salvando}>Criar cupom</Button></div>
      </form>
    </Modal>
  );
}
