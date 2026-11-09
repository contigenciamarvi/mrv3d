"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, MinusCircle, RefreshCw } from "lucide-react";
import { rpc } from "@/lib/supabase";
import { PageHeader } from "@/components/shell";
import { Button, Card, CardTitle, ErrorBox, Kpi, Loading } from "@/components/ui";

type Situacao = { agentes_ativos: number; agentes_online: number; empresas_com_agente: number; impressoras_por_conexao: Record<string, number>; versoes_agente: Record<string, number>;
  erros_integracao_7d: number; faturas_com_gateway: number; gateways: string[]; armazenamento_mb: number; versao_banco: string | null;
  ml_configurado: boolean; ml_contas: number; ml_contas_erro: number; ml_vendas_30d: number };

const CONEXAO: Record<string, string> = { bambu_lan: "Bambu Lab (rede local)", moonraker: "Klipper / Moonraker", octoprint: "OctoPrint" };

function Linha({ estado, nome, texto }: { estado: "ok" | "parcial" | "nao"; nome: string; texto: string }) {
  const I = estado === "ok" ? CheckCircle2 : estado === "parcial" ? CircleDashed : MinusCircle;
  return (
    <li className="flex gap-3 py-3">
      <I className={estado === "ok" ? "mt-0.5 h-5 w-5 shrink-0 text-emerald-600" : estado === "parcial" ? "mt-0.5 h-5 w-5 shrink-0 text-amber-500" : "mt-0.5 h-5 w-5 shrink-0 text-slate-400"} />
      <div><div className="font-medium">{nome}</div><div className="text-sm text-slate-500">{texto}</div></div>
    </li>
  );
}

/** Situação real de cada integração — o que funciona, o que depende de configuração e o que não existe */
export default function Integracoes() {
  const [d, setD] = useState<Situacao | null>(null);
  const [falha, setFalha] = useState("");
  const carregar = useCallback(async () => { setFalha(""); try { setD(await rpc<Situacao>("admin_integracoes")); } catch (e) { setFalha((e as Error).message); } }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const totalConectadas = d ? Object.values(d.impressoras_por_conexao).reduce((a, b) => a + Number(b), 0) : 0;

  return (
    <>
      <PageHeader titulo="Integrações" sub="Situação das integrações da plataforma. Chaves e senhas não aparecem aqui: ficam no servidor."
        acoes={<Button variant="secondary" onClick={carregar}><RefreshCw className="h-4 w-4" /> Atualizar</Button>} />
      {falha && <ErrorBox erro={falha} />}
      {!d && !falha ? <Loading /> : d && <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Agentes locais online" valor={`${d.agentes_online} / ${d.agentes_ativos}`} sub={`${d.empresas_com_agente} loja(s) com agente`} />
          <Kpi label="Impressoras monitoradas" valor={totalConectadas} sub={Object.entries(d.impressoras_por_conexao).map(([k, v]) => `${CONEXAO[k] || k}: ${v}`).join(" · ") || "nenhuma"} />
          <Kpi label="Erros de integração (7 dias)" valor={d.erros_integracao_7d} tom={d.erros_integracao_7d ? "vermelho" : undefined} />
          <Kpi label="Armazenamento usado" valor={`${(d.armazenamento_mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`} sub={d.versao_banco ? `Banco: ${d.versao_banco.replace(".sql", "")}` : undefined} />
        </div>
        <Card>
          <CardTitle>Integrações</CardTitle>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            <Linha estado={d.agentes_ativos ? "ok" : "parcial"} nome="Agente local de impressoras (Bambu LAN, Klipper, OctoPrint)"
              texto={`Funcionando, somente leitura. ${d.agentes_ativos ? `Versões em uso: ${Object.entries(d.versoes_agente).map(([v, n]) => `${v} (${n})`).join(", ")}.` : "Nenhuma loja pareou um agente ainda."} Revogação em Uso da Plataforma.`} />
            <Linha estado="ok" nome="Importação Bambu Studio (.gcode.3mf, .3mf, .gcode, .stl, .zip)" texto="Funcionando: o arquivo é lido no navegador da loja, sem serviço externo." />
            <Linha estado="ok" nome="Consulta de CEP" texto="Funcionando: ViaCEP, com BrasilAPI de reserva. Consulta feita pelo navegador, sem chave." />
            <Linha estado="nao" nome="Bambu Lab Cloud" texto="Indisponível: a Bambu não oferece API pública nem autorização para terceiros. Só via parceria oficial." />
            <Linha estado={d.ml_configurado ? (d.ml_contas_erro ? "parcial" : "ok") : "nao"} nome="Mercado Livre (pedidos, estoque e rastreio)"
              texto={d.ml_configurado ? `Ativo: ${d.ml_contas} conta(s) conectada(s)${d.ml_contas_erro ? `, ${d.ml_contas_erro} com erro` : ""}, ${d.ml_vendas_30d} venda(s) importada(s) em 30 dias.`
                : "Não configurado: crie o aplicativo no Mercado Livre e rode na VPS: bash /opt/mrv3d/deploy/integra/configurar-ml.sh"} />
            <Linha estado="nao" nome="Shopee e TikTok Shop" texto="Ainda não integrados: exigem aplicativo aprovado pela Shopee (Open Platform) e pelo TikTok Shop (Partner Center)." />
            <Linha estado="nao" nome="MakerWorld" texto="Sem API pública. As lojas guardam o link e a licença do modelo; o download é feito por elas." />
            <Linha estado={d.faturas_com_gateway ? "ok" : "nao"} nome="Gateway de pagamento das assinaturas"
              texto={d.faturas_com_gateway ? `Em uso: ${d.gateways.join(", ")} (${d.faturas_com_gateway} fatura(s)).` : "Não configurado: as faturas são registradas e baixadas à mão em Cobranças."} />
            <Linha estado="nao" nome="E-mail transacional (SMTP)" texto="Não configurado nesta versão: avisos chegam pelo sino do painel. Configurar exige um provedor de e-mail e a senha no servidor." />
            <Linha estado="nao" nome="Frete (Melhor Envio / Correios)" texto="Não integrado: frete e rastreio são informados à mão na Expedição." />
            <Linha estado="parcial" nome="WhatsApp" texto="Links wa.me para conversar com clientes e enviar orçamentos. Não há envio automático (exige API oficial do WhatsApp Business)." />
          </ul>
        </Card>
      </div>}
    </>
  );
}
