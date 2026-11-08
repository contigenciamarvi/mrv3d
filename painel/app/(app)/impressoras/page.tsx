"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, History, Trash2 } from "lucide-react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { sb, q } from "@/lib/supabase";
import { useDados, useParam } from "@/lib/hooks";
import { toast, erro } from "@/lib/toast";
import { brl, num, data, dataHora, numOuNull, STATUS_IMPRESSORA, TECNOLOGIAS, MATERIAIS_3D } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Modal, Table, Td, Loading, ErrorBox, Empty, Badge, tomStatus, Kpi, Confirmar, Aviso } from "@/components/ui";

type Impressora = {
  id: string; nome: string; fabricante: string | null; modelo: string | null; numero_serie: string | null; tecnologia: string;
  volume_x: number | null; volume_y: number | null; volume_z: number | null; materiais_compativeis: string[]; diametro_filamento: number | null;
  extrusores: number; potencia_w: number; custo_aquisicao: number; data_aquisicao: string | null; vida_util_horas: number; custo_manutencao_hora: number;
  custo_hora: number; horas_acumuladas: number; localizacao: string | null; operador_id: string | null; status: string; observacoes: string | null;
};
const CAMPOS = ["nome", "fabricante", "modelo", "numero_serie", "tecnologia", "volume_x", "volume_y", "volume_z", "materiais_compativeis", "diametro_filamento", "extrusores",
  "potencia_w", "custo_aquisicao", "data_aquisicao", "vida_util_horas", "custo_manutencao_hora", "horas_acumuladas", "localizacao", "operador_id", "status", "observacoes"] as const;
const NUMEROS = ["volume_x", "volume_y", "volume_z", "diametro_filamento", "extrusores", "potencia_w", "custo_aquisicao", "vida_util_horas", "custo_manutencao_hora", "horas_acumuladas"];

export default function Impressoras() { return <Exige perm="impressoras_ver"><Conteudo /></Exige>; }

function Conteudo() {
  const app = useApp();
  const pode = app.pode("impressoras_editar") && app.podeEscrever;
  const verCusto = app.pode("custos_ver");
  const idUrl = useParam("id");
  const [filtro, setFiltro] = useState("");
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [hist, setHist] = useState<Impressora | null>(null);
  const [excluir, setExcluir] = useState<Impressora | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { dados, carregando, erro: falha, recarregar } = useDados(async () => {
    const [imps, equipe] = await Promise.all([
      q<Impressora[]>(sb().from("impressoras").select("*").eq("empresa_id", app.empresa.id).order("nome")),
      sb().rpc("equipe_listar", { p_empresa: app.empresa.id }).then((r) => (r.data || []) as { user_id: string; email: string }[]),
    ]);
    return { imps, equipe };
  }, [app.empresa.id]);
  useEffect(() => { if (idUrl && dados) { const i = dados.imps.find((x) => x.id === idUrl); if (i) setHist(i); } }, [idUrl, dados]);

  const lista = (dados?.imps || []).filter((i) => !filtro || i.status === filtro);
  const abrir = (i?: Impressora) => {
    setEditId(i?.id || null);
    setForm(Object.fromEntries(CAMPOS.map((k) => {
      const v = i ? (i as unknown as Record<string, unknown>)[k] : undefined;
      if (k === "materiais_compativeis") return [k, ((v as string[]) || []).join(", ")];
      if (v == null) return [k, k === "tecnologia" ? "fdm" : k === "status" ? "disponivel" : k === "vida_util_horas" ? "5000" : k === "extrusores" ? "1" : ""];
      return [k, NUMEROS.includes(k) ? String(v).replace(".", ",") : String(v)];
    })));
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return; setSalvando(true);
    try {
      const reg: Record<string, unknown> = {};
      for (const k of CAMPOS) {
        if (k === "materiais_compativeis") reg[k] = form[k].split(",").map((x) => x.trim()).filter(Boolean);
        else if (NUMEROS.includes(k)) reg[k] = numOuNull(form[k]);
        else reg[k] = form[k] || null;
      }
      for (const k of ["potencia_w", "custo_aquisicao", "custo_manutencao_hora", "horas_acumuladas"]) reg[k] = reg[k] ?? 0;
      reg.extrusores = reg.extrusores || 1; reg.vida_util_horas = reg.vida_util_horas || 5000;
      if (editId) await q(sb().from("impressoras").update(reg).eq("id", editId));
      else await q(sb().from("impressoras").insert({ ...reg, empresa_id: app.empresa.id }));
      toast("Impressora salva"); setForm(null); recarregar();
    } catch (e2) { erro(e2); } finally { setSalvando(false); }
  };
  const mudarStatus = async (i: Impressora, status: string) => {
    try { await q(sb().from("impressoras").update({ status }).eq("id", i.id)); toast(`${i.nome}: ${STATUS_IMPRESSORA[status]}`); recarregar(); } catch (e) { erro(e); }
  };
  const apagar = async () => {
    if (!excluir) return;
    try { await q(sb().from("impressoras").delete().eq("id", excluir.id)); toast("Impressora excluída"); setExcluir(null); recarregar(); } catch (e) { erro(e); }
  };
  const contagem = (s: string) => (dados?.imps || []).filter((i) => i.status === s).length;
  const custoPrev = form ? ((numOuNull(form.custo_aquisicao) || 0) / (numOuNull(form.vida_util_horas) || 5000) + (numOuNull(form.custo_manutencao_hora) || 0)) : 0;

  return (
    <>
      <PageHeader titulo="Impressoras 3D" sub="Cadastro, situação e custo por hora de cada máquina" acoes={pode && <Button onClick={() => abrir()}><Plus className="h-4 w-4" /> Nova impressora</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Disponíveis" valor={contagem("disponivel")} /><Kpi label="Imprimindo" valor={contagem("imprimindo") + contagem("reservada")} />
        <Kpi label="Em manutenção" valor={contagem("manutencao")} /><Kpi label="Total ativas" valor={(dados?.imps || []).filter((i) => i.status !== "inativa").length} />
      </div>
      <Card>
        <div className="mb-4"><Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-48" aria-label="Filtrar situação"><option value="">Todas as situações</option>{Object.entries(STATUS_IMPRESSORA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        {falha && <ErrorBox erro={falha} onRetry={recarregar} />}
        {carregando && !dados ? <Loading /> : lista.length === 0 ? <Empty texto="Nenhuma impressora cadastrada" /> : (
          <Table head={["Impressora", "Tecnologia", "Volume (mm)", "Potência", verCusto ? "Custo/hora" : "", "Horas", "Situação", ""]}>
            {lista.map((i) => (
              <tr key={i.id}>
                <Td><div className="font-medium">{i.nome}</div><div className="text-xs text-slate-500">{[i.fabricante, i.modelo, i.numero_serie && `SN ${i.numero_serie}`].filter(Boolean).join(" · ") || "—"}</div></Td>
                <Td>{TECNOLOGIAS[i.tecnologia]?.split(" ")[0]}</Td>
                <Td className="tnum">{i.volume_x ? `${num(i.volume_x, 0)}×${num(i.volume_y, 0)}×${num(i.volume_z, 0)}` : "—"}</Td>
                <Td className="tnum">{num(i.potencia_w, 0)} W</Td>
                <Td className="tnum">{verCusto ? brl(i.custo_hora) : ""}</Td>
                <Td className="tnum">{num(i.horas_acumuladas, 1)} h</Td>
                <Td>{pode ? (
                  <Select aria-label="Situação" value={i.status} onChange={(e) => mudarStatus(i, e.target.value)} className="h-8 w-36 text-xs">{Object.entries(STATUS_IMPRESSORA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                ) : <Badge tom={tomStatus(i.status)}>{STATUS_IMPRESSORA[i.status]}</Badge>}</Td>
                <Td><div className="flex justify-end gap-1">
                  <button onClick={() => setHist(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Histórico" title="Histórico"><History className="h-4 w-4" /></button>
                  {pode && <button onClick={() => abrir(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Editar"><Pencil className="h-4 w-4" /></button>}
                  {pode && <button onClick={() => setExcluir(i)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Excluir"><Trash2 className="h-4 w-4" /></button>}
                </div></Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mt-4 text-xs text-slate-500">A conexão com OctoPrint e Klipper/Moonraker para acompanhar a impressão em tempo real chega na fase de integrações. Por enquanto, a situação é atualizada manualmente.</p>
      </Card>

      <Modal aberto={!!form} titulo={editId ? "Editar impressora" : "Nova impressora"} onClose={() => setForm(null)} largura="max-w-3xl">
        {form && <form onSubmit={salvar} className="space-y-3">
          <Grid cols={3}>
            <Field label="Nome interno"><Input required maxLength={100} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></Field>
            <Field label="Fabricante"><Input value={form.fabricante} onChange={(e) => setForm({ ...form, fabricante: e.target.value })} /></Field>
            <Field label="Modelo"><Input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></Field>
            <Field label="Número de série"><Input value={form.numero_serie} onChange={(e) => setForm({ ...form, numero_serie: e.target.value })} /></Field>
            <Field label="Tecnologia"><Select value={form.tecnologia} onChange={(e) => setForm({ ...form, tecnologia: e.target.value })}>{Object.entries(TECNOLOGIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Situação"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{Object.entries(STATUS_IMPRESSORA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </Grid>
          <Grid cols={4}>
            <Field label="Volume X (mm)"><Input inputMode="decimal" value={form.volume_x} onChange={(e) => setForm({ ...form, volume_x: e.target.value })} /></Field>
            <Field label="Volume Y (mm)"><Input inputMode="decimal" value={form.volume_y} onChange={(e) => setForm({ ...form, volume_y: e.target.value })} /></Field>
            <Field label="Volume Z (mm)"><Input inputMode="decimal" value={form.volume_z} onChange={(e) => setForm({ ...form, volume_z: e.target.value })} /></Field>
            <Field label="Extrusores"><Input inputMode="numeric" value={form.extrusores} onChange={(e) => setForm({ ...form, extrusores: e.target.value })} /></Field>
          </Grid>
          <Grid>
            <Field label="Materiais compatíveis" hint="Separe por vírgula"><Input list="mat-3d" value={form.materiais_compativeis} onChange={(e) => setForm({ ...form, materiais_compativeis: e.target.value })} placeholder="PLA, PETG, TPU" /></Field>
            {form.tecnologia === "fdm" && <Field label="Diâmetro do filamento (mm)"><Input inputMode="decimal" value={form.diametro_filamento} onChange={(e) => setForm({ ...form, diametro_filamento: e.target.value })} placeholder="1,75" /></Field>}
          </Grid>
          <datalist id="mat-3d">{MATERIAIS_3D.map((m) => <option key={m} value={m} />)}</datalist>
          <Grid cols={4}>
            <Field label="Potência média (W)"><Input inputMode="decimal" value={form.potencia_w} onChange={(e) => setForm({ ...form, potencia_w: e.target.value })} /></Field>
            <Field label="Custo de aquisição (R$)"><Input inputMode="decimal" value={form.custo_aquisicao} onChange={(e) => setForm({ ...form, custo_aquisicao: e.target.value })} /></Field>
            <Field label="Vida útil (horas)"><Input inputMode="numeric" value={form.vida_util_horas} onChange={(e) => setForm({ ...form, vida_util_horas: e.target.value })} /></Field>
            <Field label="Manutenção (R$/hora)"><Input inputMode="decimal" value={form.custo_manutencao_hora} onChange={(e) => setForm({ ...form, custo_manutencao_hora: e.target.value })} /></Field>
            <Field label="Data de aquisição"><Input type="date" value={form.data_aquisicao} onChange={(e) => setForm({ ...form, data_aquisicao: e.target.value })} /></Field>
            <Field label="Horas acumuladas"><Input inputMode="decimal" value={form.horas_acumuladas} onChange={(e) => setForm({ ...form, horas_acumuladas: e.target.value })} /></Field>
            <Field label="Localização"><Input value={form.localizacao} onChange={(e) => setForm({ ...form, localizacao: e.target.value })} /></Field>
            <Field label="Operador responsável"><Select value={form.operador_id} onChange={(e) => setForm({ ...form, operador_id: e.target.value })}><option value="">—</option>{dados?.equipe.map((u) => <option key={u.user_id} value={u.user_id}>{u.email}</option>)}</Select></Field>
          </Grid>
          <Aviso>Custo por hora da máquina: <b>{brl(custoPrev)}</b> (aquisição ÷ vida útil + manutenção). Usado nos orçamentos junto com a energia.</Aviso>
          <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button type="submit" loading={salvando}>Salvar</Button></div>
        </form>}
      </Modal>
      {hist && <Historico i={hist} onClose={() => setHist(null)} />}
      <Confirmar aberto={!!excluir} titulo="Excluir impressora" perigo confirmar="Excluir" onCancel={() => setExcluir(null)} onOk={apagar}
        texto={<>Excluir <b>{excluir?.nome}</b>? O histórico dela será apagado. Para manter o histórico, marque como <b>Inativa</b>.</>} />
    </>
  );
}

function Historico({ i, onClose }: { i: Impressora; onClose: () => void }) {
  const { dados, carregando } = useDados(() => q<{ id: number; status_anterior: string | null; status_novo: string; created_at: string }[]>(
    sb().from("impressora_eventos").select("*").eq("impressora_id", i.id).order("created_at", { ascending: false }).limit(200)), [i.id]);
  const paradas = (dados || []).filter((e) => e.status_novo === "manutencao").length;
  return (
    <Modal aberto titulo={`Histórico · ${i.nome}`} onClose={onClose} largura="max-w-2xl">
      <div className="mb-4 grid grid-cols-3 gap-3"><Kpi label="Horas acumuladas" valor={`${num(i.horas_acumuladas, 1)} h`} /><Kpi label="Idas à manutenção" valor={paradas} /><Kpi label="Desde" valor={<span className="text-base">{data(i.data_aquisicao)}</span>} /></div>
      {carregando ? <Loading /> : !dados?.length ? <Empty texto="Sem eventos" /> : (
        <Table head={["Quando", "De", "Para"]}>{dados.map((e) => (
          <tr key={e.id}><Td>{dataHora(e.created_at)}</Td><Td>{e.status_anterior ? STATUS_IMPRESSORA[e.status_anterior] : "Cadastro"}</Td><Td><Badge tom={tomStatus(e.status_novo)}>{STATUS_IMPRESSORA[e.status_novo]}</Badge></Td></tr>
        ))}</Table>
      )}
      <p className="mt-3 text-xs text-slate-500">Produção realizada, taxa de falhas e eficiência por máquina passam a ser medidas com as Ordens de Produção (próxima fase).</p>
    </Modal>
  );
}
