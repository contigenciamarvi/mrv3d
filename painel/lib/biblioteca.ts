"use client";
import { sb, q, rpc, enviarArquivo } from "./supabase";
import type { Importado } from "./importar3d";

export type Projeto = { id: string; nome: string; origem: string; arquivo_path: string | null; arquivo_nome: string | null; formato: string | null; tamanho_bytes: number | null; sha256: string | null;
  miniatura_path: string | null; pecas: number | null; placas: number | null; tempo_estimado_min: number | null; peso_g: number | null; materiais: string[]; cores: string[];
  impressora_modelo: string | null; bico_mm: number | null; altura_camada_mm: number | null; preenchimento: string | null; fatiador: string | null; volume_cm3: number | null;
  dimensoes_mm: number[] | null; metadados: Record<string, unknown>; makerworld_url: string | null; autor: string | null; licenca: string | null; uso_comercial: string; descricao: string | null;
  tags: string[]; produto_id: string | null; arquivado: boolean; created_at: string; updated_at: string; produtos?: { nome: string } | null;
  versao: number; projeto_raiz_id: string | null; copia_de: string | null };

export const LICENCAS: Record<string, string> = {
  propria: "Projeto próprio", cc0: "CC0 (domínio público)", cc_by: "CC BY", cc_by_sa: "CC BY-SA", cc_by_nd: "CC BY-ND", cc_by_nc: "CC BY-NC (sem uso comercial)",
  cc_by_nc_sa: "CC BY-NC-SA (sem uso comercial)", cc_by_nc_nd: "CC BY-NC-ND (sem uso comercial)", sdfl: "Standard Digital File License do MakerWorld (uso pessoal)",
  licenca_comercial: "Licença comercial comprada do autor", outra: "Outra / verificar",
};
export const ORIGENS: Record<string, string> = { upload: "Importado manualmente", makerworld: "Modelo público (MakerWorld)", sincronizado: "Sincronizado da conta" };
/** licença escrita no 3MF → código do sistema */
export function licencaDoArquivo(l: string | null): string | null {
  if (!l || !l.trim()) return null;
  const s = l.toLowerCase().replace(/[^a-z0-9í]+/g, "_");
  const tem = (re: RegExp) => re.test("_" + s + "_");
  if (tem(/standard_digital|_sdfl_/)) return "sdfl";
  if (tem(/_cc0_|public_domain|dom[ií]nio/)) return "cc0";
  const nc = tem(/_nc_|noncommercial|non_commercial|n[aã]o_comercial/);
  const nd = tem(/_nd_|noderiv|no_deriv/);
  const sa = tem(/_sa_|sharealike|share_alike/);
  const by = tem(/_by_|attribution/) || nc || nd || sa;
  if (nc) return nd ? "cc_by_nc_nd" : sa ? "cc_by_nc_sa" : "cc_by_nc";
  if (by) return nd ? "cc_by_nd" : sa ? "cc_by_sa" : "cc_by";
  return "outra";
}
/** Uso comercial que o banco vai calcular para a licença (o banco é quem decide). */
export function usoComercial(licenca: string | null): "permitido" | "proibido" | "verificar" {
  if (licenca && ["propria", "cc0", "cc_by", "cc_by_sa", "cc_by_nd", "licenca_comercial"].includes(licenca)) return "permitido";
  if (licenca && ["cc_by_nc", "cc_by_nc_sa", "cc_by_nc_nd", "sdfl"].includes(licenca)) return "proibido";
  return "verificar";
}

/** Salva o arquivo importado na biblioteca da empresa. Não duplica (mesmo arquivo = mesmo projeto). */
export async function salvarNaBiblioteca(empresa: string, imp: Importado, extra: { nome: string; licenca?: string | null; descricao?: string | null; tags?: string[] }) {
  const [existe] = await q<Projeto[]>(sb().from("projetos_3d").select("*").eq("empresa_id", empresa).eq("sha256", imp.sha256).limit(1));
  if (existe) {
    await rpc("registrar_evento_importacao", { p_empresa: empresa, p_tipo: "duplicado", p_mensagem: `Arquivo já estava na biblioteca: ${existe.nome}` }).catch(() => undefined);
    return { projeto: existe, duplicado: true };
  }
  const path = await enviarArquivo(empresa, "projetos", imp.arquivo);
  let mini: string | null = null;
  if (imp.miniatura?.length) {
    try { mini = await enviarArquivo(empresa, "projetos", new File([imp.miniatura as BlobPart], "miniatura.png", { type: "image/png" })); } catch { /* sem miniatura */ }
  }
  const tipos = Array.from(new Set(imp.filamentos.map((f) => f.tipo).filter(Boolean))) as string[];
  const cores = Array.from(new Set(imp.filamentos.map((f) => f.cor).filter(Boolean))) as string[];
  const [p] = await q<Projeto[]>(sb().from("projetos_3d").insert({
    empresa_id: empresa, nome: extra.nome.slice(0, 200), origem: "upload", arquivo_path: path, arquivo_nome: imp.arquivo.name.slice(0, 200), formato: imp.tipo === "desconhecido" ? null : imp.tipo,
    tamanho_bytes: imp.arquivo.size, sha256: imp.sha256, miniatura_path: mini, pecas: imp.objetos, placas: imp.placas.length || null, tempo_estimado_min: imp.tempo_total_min, peso_g: imp.peso_total_g,
    materiais: tipos, cores, impressora_modelo: imp.impressora, bico_mm: imp.bico_mm, altura_camada_mm: imp.altura_camada_mm, preenchimento: imp.preenchimento, fatiador: imp.fatiador,
    volume_cm3: imp.geometria ? Math.round(imp.geometria.volume_cm3 * 1000) / 1000 : null, dimensoes_mm: imp.geometria?.dimensoes_mm ?? null,
    autor: imp.designer, licenca: extra.licenca ?? licencaDoArquivo(imp.licenca) ?? "propria", descricao: extra.descricao ?? imp.descricao, tags: extra.tags ?? [],
    metadados: { fatiado: imp.fatiado, suportes: imp.suportes, peso_inclui_purga_suporte: imp.peso_inclui_purga_suporte, configuracoes: imp.configuracoes, avisos: imp.avisos,
      placas: imp.placas.map((pl) => ({ indice: pl.indice, nome: pl.nome, tempo_min: pl.tempo_min, peso_g: pl.peso_g, objetos: pl.objetos, filamentos: pl.filamentos, suportes: pl.suportes })),
      filamentos: imp.filamentos, licenca_no_arquivo: imp.licenca },
  }).select("*"));
  return { projeto: p, duplicado: false };
}
