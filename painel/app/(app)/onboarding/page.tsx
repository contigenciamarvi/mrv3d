"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/shell";
import { sb, rpc, q, enviarArquivo } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { cn, numOuNull, MATERIAIS_3D, TECNOLOGIAS, brl } from "@/lib/utils";
import { Button, Card, Field, Input, Select, Textarea, Grid, Aviso } from "@/components/ui";
import { CamposEndereco } from "@/components/cep";

const ETAPAS = ["Empresa", "Impressoras", "Materiais", "Custos", "Preferências"];
type Imp = { fabricante: string; modelo: string; nome: string; numero_serie: string; tecnologia: string; quantidade: string; potencia_w: string; custo_aquisicao: string; vida_util_horas: string; custo_manutencao_hora: string; volume: string };
type Mat = { material: string; cor: string; unidade: string; preco: string; quantidade: string };
const impVazia = (): Imp => ({ fabricante: "", modelo: "", nome: "", numero_serie: "", tecnologia: "fdm", quantidade: "1", potencia_w: "150", custo_aquisicao: "", vida_util_horas: "5000", custo_manutencao_hora: "0,10", volume: "" });

export default function Onboarding() {
  const app = useApp();
  const router = useRouter();
  const [etapa, setEtapa] = useState(Math.min(app.config.onboarding_etapa || 0, 4));
  const [salvando, setSalvando] = useState(false);
  const [emp, setEmp] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<File | null>(null);
  const [imps, setImps] = useState<Imp[]>([impVazia()]);
  const [mats, setMats] = useState<Mat[]>([{ material: "PLA", cor: "Preto", unidade: "kg", preco: "", quantidade: "" }]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [jaTem, setJaTem] = useState({ impressoras: 0, materiais: 0 });

  useEffect(() => {
    (async () => {
      const e = await q<Record<string, string>>(sb().from("empresas").select("nome,documento,email,telefone,whatsapp,endereco,numero_endereco,complemento,bairro,cidade,uf,cep").eq("id", app.empresa.id).single());
      setEmp(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ""])));
      const c = app.config;
      setCfg({
        energia_kwh: String(c.energia_kwh).replace(".", ","), mao_obra_hora: String(c.mao_obra_hora).replace(".", ","), margem_pct: String(c.margem_pct).replace(".", ","),
        impostos_pct: String(c.impostos_pct).replace(".", ","), taxas_pct: String(c.taxas_pct).replace(".", ","), desperdicio_pct: String(c.desperdicio_pct).replace(".", ","),
        custos_fixos_mensais: String(c.custos_fixos_mensais).replace(".", ","), embalagem_padrao: String(c.embalagem_padrao).replace(".", ","),
        fuso: c.fuso, prefixo_pedido: c.prefixo_pedido, prefixo_orcamento: c.prefixo_orcamento, prazo_padrao_dias: String(c.prazo_padrao_dias),
        validade_orcamento_dias: String(c.validade_orcamento_dias), msg_orcamento: c.msg_orcamento, msg_pedido: c.msg_pedido,
      });
      const [{ count: ni }, { count: nm }] = await Promise.all([
        sb().from("impressoras").select("id", { count: "exact", head: true }).eq("empresa_id", app.empresa.id),
        sb().from("materiais").select("id", { count: "exact", head: true }).eq("empresa_id", app.empresa.id),
      ]);
      setJaTem({ impressoras: ni || 0, materiais: nm || 0 });
    })().catch(erro);
  }, [app.empresa.id, app.config]);

  const salvarEtapa = async (prox: number) => {
    await q(sb().from("empresa_config").update({ onboarding_etapa: prox }).eq("empresa_id", app.empresa.id));
    setEtapa(prox);
    window.scrollTo({ top: 0 });
  };

  const avancar = async () => {
    setSalvando(true);
    try {
      if (etapa === 0) {
        if (!emp.nome?.trim()) throw new Error("Informe o nome fantasia");
        const { nome, documento, email, telefone, whatsapp, endereco, numero_endereco, complemento, bairro, cidade, uf, cep } = emp;
        await q(sb().from("empresas").update({ nome: nome.trim(), documento: documento || null, email: email || null, telefone: telefone || null,
          whatsapp: whatsapp || null, endereco: endereco || null, numero_endereco: numero_endereco || null, complemento: complemento || null, bairro: bairro || null, cidade: cidade || null, uf: uf || null, cep: cep || null }).eq("id", app.empresa.id));
        if (logo) {
          const path = await enviarArquivo(app.empresa.id, "logo", logo);
          await q(sb().from("empresa_config").update({ logo_path: path }).eq("empresa_id", app.empresa.id));
        }
      }
      if (etapa === 1) {
        const linhas = imps.filter((i) => i.modelo.trim() || i.nome.trim());
        const registros = linhas.flatMap((i) => Array.from({ length: Math.max(1, Math.min(50, Number(i.quantidade) || 1)) }, (_, k) => ({
          empresa_id: app.empresa.id,
          nome: (i.nome.trim() || `${i.fabricante} ${i.modelo}`.trim()) + (Number(i.quantidade) > 1 ? ` #${k + 1}` : ""),
          fabricante: i.fabricante || null, modelo: i.modelo || null, numero_serie: Number(i.quantidade) > 1 ? null : i.numero_serie || null,
          tecnologia: i.tecnologia, potencia_w: numOuNull(i.potencia_w) ?? 0, custo_aquisicao: numOuNull(i.custo_aquisicao) ?? 0,
          vida_util_horas: numOuNull(i.vida_util_horas) || 5000, custo_manutencao_hora: numOuNull(i.custo_manutencao_hora) ?? 0,
          ...(() => { const [x, y, z] = i.volume.split(/[x×*]/i).map((v) => numOuNull(v)); return { volume_x: x, volume_y: y, volume_z: z }; })(),
        })));
        if (registros.length) await q(sb().from("impressoras").insert(registros));
      }
      if (etapa === 2) {
        for (const m of mats.filter((m) => m.material.trim())) {
          const tipo = /resina/i.test(m.material) ? "resina" : "filamento";
          await rpc("cadastrar_materia_prima", {
            p_empresa: app.empresa.id,
            p_dados: { nome: `${m.material} ${m.cor}`.trim(), categoria: tipo, material: m.material, cor: m.cor, unidade: m.unidade || "kg", diametro: tipo === "filamento" ? "1.75" : "" },
            p_quantidade_inicial: numOuNull(m.quantidade) || 0, p_custo_unitario: numOuNull(m.preco),
          });
        }
      }
      if (etapa === 3 || etapa === 4) {
        const n = (k: string) => numOuNull(cfg[k]);
        const soma = (n("margem_pct") || 0) + (n("impostos_pct") || 0) + (n("taxas_pct") || 0);
        if (soma >= 100) throw new Error("Margem + impostos + taxas precisam somar menos que 100%");
        await q(sb().from("empresa_config").update({
          energia_kwh: n("energia_kwh") ?? 0, mao_obra_hora: n("mao_obra_hora") ?? 0, margem_pct: n("margem_pct") ?? 0, impostos_pct: n("impostos_pct") ?? 0,
          taxas_pct: n("taxas_pct") ?? 0, desperdicio_pct: n("desperdicio_pct") ?? 0, custos_fixos_mensais: n("custos_fixos_mensais") ?? 0,
          embalagem_padrao: n("embalagem_padrao") ?? 0, fuso: cfg.fuso, prefixo_pedido: cfg.prefixo_pedido, prefixo_orcamento: cfg.prefixo_orcamento,
          prazo_padrao_dias: Number(cfg.prazo_padrao_dias) || 0, validade_orcamento_dias: Number(cfg.validade_orcamento_dias) || 15,
          msg_orcamento: cfg.msg_orcamento, msg_pedido: cfg.msg_pedido,
          ...(etapa === 4 ? { onboarding_concluido: true } : {}),
        }).eq("empresa_id", app.empresa.id));
      }
      if (etapa === 4) {
        toast("Tudo pronto! Bem-vindo ao seu painel.");
        await app.recarregar();
        router.replace("/dashboard/");
        return;
      }
      await salvarEtapa(etapa + 1);
      toast("Etapa salva");
    } catch (e) { erro(e); } finally { setSalvando(false); }
  };

  const pular = async () => {
    if (etapa === 4) {
      await q(sb().from("empresa_config").update({ onboarding_concluido: true }).eq("empresa_id", app.empresa.id)).catch(erro);
      await app.recarregar(); router.replace("/dashboard/"); return;
    }
    salvarEtapa(etapa + 1).catch(erro);
  };

  const campoEmp = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}><Input value={emp[k] || ""} onChange={(e) => setEmp({ ...emp, [k]: e.target.value })} {...props} /></Field>
  );
  const campoCfg = (k: string, label: string, hint?: string, sufixo?: string) => (
    <Field label={label} hint={hint}>
      <div className="relative"><Input inputMode="decimal" value={cfg[k] || ""} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} className={sufixo ? "pr-12" : ""} />
        {sufixo && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{sufixo}</span>}</div>
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">Configuração inicial</h1>
      <p className="mt-1 text-sm text-slate-500">Cinco passos rápidos. Tudo pode ser alterado depois em Configurações.</p>
      <ol className="my-6 flex flex-wrap gap-2" aria-label="Etapas">
        {ETAPAS.map((n, i) => (
          <li key={n} className={cn("flex items-center gap-2 rounded-full px-3 py-1 text-sm", i === etapa ? "bg-brand-600 text-zinc-950" : i < etapa ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>
            {i < etapa ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">{i + 1}</span>} {n}
          </li>
        ))}
      </ol>

      <Card>
        {etapa === 0 && (
          <div className="space-y-3">
            <Grid>
              {campoEmp("nome", "Nome fantasia", { required: true, maxLength: 200 })}
              {campoEmp("documento", "CPF ou CNPJ", { maxLength: 20 })}
              {campoEmp("email", "E-mail", { type: "email" })}
              {campoEmp("whatsapp", "WhatsApp", { inputMode: "tel" })}
              {campoEmp("telefone", "Telefone", { inputMode: "tel" })}
            </Grid>
            <CamposEndereco v={emp} set={(p) => setEmp((x) => ({ ...x, ...(p as Record<string, string>) }))} />
            <Field label="Logotipo" hint="PNG, JPG ou WEBP. Aparece nos orçamentos.">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <Upload className="h-4 w-4" /> {logo ? logo.name : "Escolher imagem"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setLogo(e.target.files?.[0] || null)} />
              </label>
            </Field>
          </div>
        )}

        {etapa === 1 && (
          <div className="space-y-4">
            {jaTem.impressoras > 0 && <Aviso>Você já tem {jaTem.impressoras} impressora(s) cadastrada(s). Adicione outras abaixo ou avance.</Aviso>}
            {imps.map((i, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <Grid cols={3}>
                  <Field label="Fabricante"><Input value={i.fabricante} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, fabricante: e.target.value } : x))} placeholder="Bambu Lab" /></Field>
                  <Field label="Modelo"><Input value={i.modelo} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, modelo: e.target.value } : x))} placeholder="P1S" /></Field>
                  <Field label="Nome interno / nº"><Input value={i.nome} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, nome: e.target.value } : x))} placeholder="Impressora 1" /></Field>
                  <Field label="Tecnologia"><Select value={i.tecnologia} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, tecnologia: e.target.value } : x))}>{Object.entries(TECNOLOGIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="Quantidade de máquinas"><Input inputMode="numeric" value={i.quantidade} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, quantidade: e.target.value } : x))} /></Field>
                  <Field label="Nº de série"><Input value={i.numero_serie} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, numero_serie: e.target.value } : x))} /></Field>
                  <Field label="Potência média (W)"><Input inputMode="decimal" value={i.potencia_w} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, potencia_w: e.target.value } : x))} /></Field>
                  <Field label="Valor de aquisição (R$)"><Input inputMode="decimal" value={i.custo_aquisicao} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, custo_aquisicao: e.target.value } : x))} /></Field>
                  <Field label="Vida útil (horas)"><Input inputMode="numeric" value={i.vida_util_horas} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, vida_util_horas: e.target.value } : x))} /></Field>
                  <Field label="Manutenção (R$/hora)"><Input inputMode="decimal" value={i.custo_manutencao_hora} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, custo_manutencao_hora: e.target.value } : x))} /></Field>
                  <Field label="Volume (mm)" hint="Ex.: 256x256x256"><Input value={i.volume} onChange={(e) => setImps(imps.map((x, j) => j === idx ? { ...x, volume: e.target.value } : x))} /></Field>
                </Grid>
                {imps.length > 1 && <button onClick={() => setImps(imps.filter((_, j) => j !== idx))} className="mt-2 flex items-center gap-1 text-xs text-red-600"><Trash2 className="h-3 w-3" /> Remover</button>}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setImps([...imps, impVazia()])}><Plus className="h-4 w-4" /> Outro modelo</Button>
            <p className="text-xs text-slate-500">O custo/hora da máquina é calculado: valor ÷ vida útil + manutenção por hora.</p>
          </div>
        )}

        {etapa === 2 && (
          <div className="space-y-3">
            {jaTem.materiais > 0 && <Aviso>Você já tem {jaTem.materiais} item(ns) de matéria-prima. Adicione outros abaixo ou avance.</Aviso>}
            {mats.map((m, idx) => (
              <div key={idx} className="grid items-end gap-2 sm:grid-cols-[1.2fr_1fr_0.7fr_1fr_1fr_auto]">
                <Field label="Material"><Input list="lista-materiais" value={m.material} onChange={(e) => setMats(mats.map((x, j) => j === idx ? { ...x, material: e.target.value } : x))} /></Field>
                <Field label="Cor"><Input value={m.cor} onChange={(e) => setMats(mats.map((x, j) => j === idx ? { ...x, cor: e.target.value } : x))} /></Field>
                <Field label="Unidade"><Select value={m.unidade} onChange={(e) => setMats(mats.map((x, j) => j === idx ? { ...x, unidade: e.target.value } : x))}><option value="kg">kg</option><option value="l">litro</option><option value="g">g</option></Select></Field>
                <Field label={`Preço por ${m.unidade}`}><Input inputMode="decimal" value={m.preco} onChange={(e) => setMats(mats.map((x, j) => j === idx ? { ...x, preco: e.target.value } : x))} placeholder="120,00" /></Field>
                <Field label="Tenho em estoque"><Input inputMode="decimal" value={m.quantidade} onChange={(e) => setMats(mats.map((x, j) => j === idx ? { ...x, quantidade: e.target.value } : x))} placeholder="0" /></Field>
                <button onClick={() => setMats(mats.filter((_, j) => j !== idx))} className="mb-2 rounded p-2 text-slate-400 hover:text-red-600" aria-label="Remover"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <datalist id="lista-materiais">{MATERIAIS_3D.map((m) => <option key={m} value={m} />)}</datalist>
            <div className="flex flex-wrap gap-2">
              {["PLA", "PETG", "ABS", "ASA", "TPU", "Resina padrão"].map((m) => (
                <Button key={m} variant="secondary" size="sm" onClick={() => setMats([...mats, { material: m, cor: "", unidade: /resina/i.test(m) ? "l" : "kg", preco: "", quantidade: "" }])}><Plus className="h-3 w-3" /> {m}</Button>
              ))}
            </div>
          </div>
        )}

        {etapa === 3 && (
          <div className="space-y-3">
            <Grid>
              {campoCfg("energia_kwh", "Energia elétrica", "Veja na sua conta de luz (R$ por kWh)", "R$/kWh")}
              {campoCfg("mao_obra_hora", "Mão de obra", "Quanto vale 1 hora do seu trabalho", "R$/h")}
              {campoCfg("margem_pct", "Margem de lucro desejada", undefined, "%")}
              {campoCfg("impostos_pct", "Impostos sobre a venda", "Ex.: Simples Nacional ~6%", "%")}
              {campoCfg("taxas_pct", "Taxas de pagamento", "Maquininha, marketplace etc.", "%")}
              {campoCfg("desperdicio_pct", "Desperdício médio", "Purga, suportes, falhas", "%")}
              {campoCfg("custos_fixos_mensais", "Custos fixos por mês", "Aluguel, internet, softwares…", "R$")}
              {campoCfg("embalagem_padrao", "Embalagem padrão por pedido", undefined, "R$")}
            </Grid>
            <Aviso>Preço sugerido = custo ÷ (1 − margem − impostos − taxas). Com os valores acima, um custo de R$ 10,00 vira{" "}
              <b>{(() => { const d = 1 - ((numOuNull(cfg.margem_pct) || 0) + (numOuNull(cfg.impostos_pct) || 0) + (numOuNull(cfg.taxas_pct) || 0)) / 100; return d > 0 ? brl(10 / d) : "—"; })()}</b>.</Aviso>
          </div>
        )}

        {etapa === 4 && (
          <div className="space-y-3">
            <Grid>
              <Field label="Moeda"><Input value="Real (BRL)" disabled /></Field>
              <Field label="Fuso horário"><Select value={cfg.fuso} onChange={(e) => setCfg({ ...cfg, fuso: e.target.value })}>
                {["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"].map((f) => <option key={f}>{f}</option>)}
              </Select></Field>
              <Field label="Prefixo dos pedidos"><Input maxLength={10} value={cfg.prefixo_pedido || ""} onChange={(e) => setCfg({ ...cfg, prefixo_pedido: e.target.value })} /></Field>
              <Field label="Prefixo dos orçamentos"><Input maxLength={10} value={cfg.prefixo_orcamento || ""} onChange={(e) => setCfg({ ...cfg, prefixo_orcamento: e.target.value })} /></Field>
              <Field label="Prazo padrão de entrega (dias)"><Input inputMode="numeric" value={cfg.prazo_padrao_dias || ""} onChange={(e) => setCfg({ ...cfg, prazo_padrao_dias: e.target.value })} /></Field>
              <Field label="Validade dos orçamentos (dias)"><Input inputMode="numeric" value={cfg.validade_orcamento_dias || ""} onChange={(e) => setCfg({ ...cfg, validade_orcamento_dias: e.target.value })} /></Field>
            </Grid>
            <Field label="Mensagem de envio do orçamento (WhatsApp)" hint="Use {cliente}, {numero}, {empresa}, {total} e {link}">
              <Textarea value={cfg.msg_orcamento || ""} onChange={(e) => setCfg({ ...cfg, msg_orcamento: e.target.value })} />
            </Field>
            <Field label="Mensagem de pedido registrado" hint="Use {cliente}, {numero} e {prazo}">
              <Textarea value={cfg.msg_pedido || ""} onChange={(e) => setCfg({ ...cfg, msg_pedido: e.target.value })} />
            </Field>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button variant="ghost" disabled={etapa === 0} onClick={() => salvarEtapa(etapa - 1).catch(erro)}>Voltar</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={pular}>{etapa === 4 ? "Concluir depois" : "Pular"}</Button>
            <Button loading={salvando} onClick={avancar}>{etapa === 4 ? "Concluir" : "Salvar e continuar"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
