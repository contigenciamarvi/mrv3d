"use client";
import { useCallback, useEffect, useState } from "react";
import { sb, rpc } from "@/lib/supabase";
import { toast, erro } from "@/lib/toast";
import { dataHora } from "@/lib/utils";
import { PageHeader, useSessao } from "@/components/shell";
import { Button, Card, CardTitle, ErrorBox, Field, Input, Loading, Textarea } from "@/components/ui";

type Cfg = { nome_plataforma: string; email_suporte: string | null; whatsapp_suporte: string | null; horario_suporte: string | null; url_termos: string | null; url_privacidade: string | null;
  manutencao_ativa: boolean; manutencao_mensagem: string | null; limite_chamados_dia: number; updated_at: string };

/** Dados da plataforma que as lojas veem (contato do suporte, termos) e o aviso de manutenção */
export default function Configuracoes() {
  const { papel } = useSessao();
  const pode = ["proprietario", "administrador"].includes(papel || "");
  const [f, setF] = useState<Record<string, string | boolean | number> | null>(null);
  const [atualizado, setAtualizado] = useState("");
  const [falha, setFalha] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    const { data: c, error } = await sb().from("configuracao_plataforma").select("*").eq("id", 1).single();
    if (error) { setFalha(error.message); return; }
    const x = c as Cfg;
    setAtualizado(x.updated_at);
    setF({ nome_plataforma: x.nome_plataforma, email_suporte: x.email_suporte || "", whatsapp_suporte: x.whatsapp_suporte || "", horario_suporte: x.horario_suporte || "",
      url_termos: x.url_termos || "", url_privacidade: x.url_privacidade || "", manutencao_ativa: x.manutencao_ativa, manutencao_mensagem: x.manutencao_mensagem || "", limite_chamados_dia: x.limite_chamados_dia });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const txt = (k: string, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <Field label={label} hint={hint}><Input disabled={!pode} value={String(f?.[k] ?? "")} onChange={(e) => setF({ ...f!, [k]: e.target.value })} {...props} /></Field>
  );

  return (
    <>
      <PageHeader titulo="Configurações da plataforma" sub="Contato do suporte, links legais e modo de manutenção. Mudanças ficam na auditoria." />
      {falha && <ErrorBox erro={falha} />}
      {!f ? !falha && <Loading /> : (
        <form className="space-y-6" onSubmit={async (e) => { e.preventDefault(); setSalvando(true);
          try { await rpc("admin_salvar_configuracao", { p: f }); toast("Configurações salvas"); carregar(); } catch (x) { erro(x); } finally { setSalvando(false); } }}>
          <Card>
            <CardTitle>Plataforma e suporte</CardTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {txt("nome_plataforma", "Nome da plataforma", { required: true, minLength: 2, maxLength: 80 })}
              {txt("email_suporte", "E-mail do suporte", { type: "email", maxLength: 150 })}
              {txt("whatsapp_suporte", "WhatsApp do suporte", { inputMode: "tel", placeholder: "(54) 99999-0000" }, "Com DDD. O código do país (55) é opcional.")}
              {txt("horario_suporte", "Horário de atendimento", { maxLength: 120, placeholder: "Seg a sex, 9h às 18h" })}
              {txt("url_termos", "Link dos termos de uso", { type: "url", placeholder: "https://…" })}
              {txt("url_privacidade", "Link da política de privacidade", { type: "url", placeholder: "https://…" })}
              {txt("limite_chamados_dia", "Chamados por loja por dia", { type: "number", min: 1, max: 100 }, "Evita abuso. As lojas ainda podem responder chamados abertos.")}
            </div>
            <p className="mt-3 text-xs text-slate-500">O contato aparece na página Suporte do painel das lojas.</p>
          </Card>
          <Card>
            <CardTitle>Manutenção</CardTitle>
            <label className="mb-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={!pode} checked={!!f.manutencao_ativa} onChange={(e) => setF({ ...f, manutencao_ativa: e.target.checked })} />
              Mostrar aviso de manutenção para todas as lojas</label>
            <Field label="Mensagem" hint="Aparece numa faixa no topo do painel das lojas (em até 5 minutos). O sistema continua funcionando: é só um aviso.">
              <Textarea disabled={!pode} maxLength={500} rows={3} value={String(f.manutencao_mensagem)} onChange={(e) => setF({ ...f, manutencao_mensagem: e.target.value })} placeholder="Ex.: Atualização hoje às 22h. O sistema pode ficar fora do ar por 10 minutos." /></Field>
          </Card>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Última alteração: {dataHora(atualizado)}</span>
            {pode ? <Button type="submit" loading={salvando}>Salvar</Button> : <span className="text-sm text-slate-500">Só proprietário ou administrador altera.</span>}
          </div>
        </form>)}
    </>
  );
}
