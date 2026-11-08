// Leitura de projetos do Bambu Studio / Orca / Prusa / Cura — sem rede, sem executar nada do arquivo.
// Puro TypeScript (só depende do fflate) para poder ser testado fora do navegador.
import { unzipSync, strFromU8 } from "fflate";

export type TipoArquivo = "gcode.3mf" | "3mf" | "gcode" | "stl" | "obj" | "step" | "desconhecido";
export type Filamento = { slot: number; tipo: string | null; cor: string | null; peso_g: number | null; metros: number | null; perfil: string | null };
export type Placa = { indice: number; nome: string | null; tempo_min: number | null; peso_g: number | null; objetos: string[]; filamentos: Filamento[]; suportes: boolean | null; miniatura: Uint8Array | null };
export type Extracao = {
  tipo: TipoArquivo; fatiado: boolean; nome: string | null; fatiador: string | null; impressora: string | null; bico_mm: number | null; altura_camada_mm: number | null;
  preenchimento: string | null; suportes: boolean | null; placas: Placa[]; objetos: number | null; filamentos: Filamento[]; tempo_total_min: number | null; peso_total_g: number | null;
  designer: string | null; licenca: string | null; descricao: string | null; miniatura: Uint8Array | null; configuracoes: Record<string, string>;
  /** o peso do fatiador já inclui suportes, torre de purga e trocas de cor (não somar de novo) */
  peso_inclui_purga_suporte: boolean | null; avisos: string[];
};

// ---------- limites contra arquivos malformados ou "zip bomb" ----------
export const LIMITES = {
  arquivoMax: 200 * 1048576, // 200 MB
  entradasZip: 5000,
  configMax: 20 * 1048576, // cada .config/.json/.model de metadados
  modeloMax: 150 * 1048576, // 3D/3dmodel.model descompactado
  gcodeMax: 120 * 1048576,
  imagemMax: 8 * 1048576,
  totalDescompactado: 400 * 1048576,
  razaoMax: 1000, // descompactado/compactado
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const texto = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f]/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const desescapar = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const cor = (v: unknown) => { const s = texto(v, 20); if (!s) return null; const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s); return m ? `#${m[1].toUpperCase()}` : s; };

/** "1d 2h 3m 4s" | "1h 2m" | "93m 5s" | "5025" (segundos) → minutos */
export function tempoEmMinutos(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round((Number(t) / 60) * 10) / 10;
  let seg = 0, achou = false;
  for (const [, v, u] of t.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) { achou = true; seg += Number(v) * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[u.toLowerCase()]; }
  return achou ? Math.round((seg / 60) * 10) / 10 : null;
}

/** atributos de uma tag XML simples: <x a="1" b='2'/> */
function attrs(tag: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [, k, , v1, v2] of tag.slice(0, 8000).matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) r[k] = desescapar(v1 ?? v2 ?? "");
  return r;
}
const metadados = (bloco: string) => Object.fromEntries(Array.from(bloco.matchAll(/<metadata\b[^>]*>/g)).map((m) => attrs(m[0])).filter((a) => a.key).map((a) => [a.key, a.value ?? ""]));

/** "chave = valor" linha a linha, sem regex com retrocesso (arquivo malicioso não trava a aba) */
function chavesValores(txt: string, comentario: boolean, cb: (k: string, v: string) => void) {
  let ini = 0;
  while (ini < txt.length) {
    let fim = txt.indexOf("\n", ini); if (fim < 0) fim = txt.length;
    let l = txt.slice(ini, Math.min(fim, ini + 4000)); ini = fim + 1;
    l = l.trimStart();
    if (comentario) { if (l[0] !== ";") continue; l = l.slice(1).trimStart(); }
    const eq = l.indexOf("=");
    if (eq < 1 || eq > 80) continue;
    const k = l.slice(0, eq).trim();
    if (!/^[a-z][\w ]*$/i.test(k)) continue;
    cb(k, l.slice(eq + 1).trim());
  }
}

/** blocos <tag ...>corpo</tag> em tempo linear (sem regex preguiçosa sobre o arquivo inteiro) */
function blocos(src: string, abre: string, fecha: string, max = 5000): { tag: string; corpo: string }[] {
  const r: { tag: string; corpo: string }[] = [];
  let pos = 0;
  while (r.length < max) {
    const a = src.indexOf(abre, pos); if (a < 0) break;
    const fimTag = src.indexOf(">", a); if (fimTag < 0) break;
    const f = src.indexOf(fecha, fimTag); if (f < 0) break;
    r.push({ tag: src.slice(a, fimTag + 1), corpo: src.slice(fimTag + 1, f) });
    pos = f + fecha.length;
  }
  return r;
}

/** Detecta o tipo pelo conteúdo, não pela extensão */
export function detectarTipo(cabeca: Uint8Array, tamanho: number, nomeZip?: string[]): TipoArquivo {
  if (cabeca[0] === 0x50 && cabeca[1] === 0x4b && cabeca[2] === 0x03 && cabeca[3] === 0x04) {
    if (nomeZip && nomeZip.some((n) => /^Metadata\/plate_\d+\.gcode$/i.test(n))) return "gcode.3mf";
    return "3mf";
  }
  const txt = strFromU8(cabeca.subarray(0, Math.min(cabeca.length, 4096)), true);
  if (/ISO-10303-21/.test(txt)) return "step";
  if (tamanho >= 84) {
    const n = new DataView(cabeca.buffer, cabeca.byteOffset, Math.min(cabeca.byteLength, 84)).getUint32(80, true);
    if (cabeca.byteLength >= 84 && 84 + n * 50 === tamanho) return "stl";
  }
  if (/^\s*solid\b/i.test(txt) && /facet\s+normal/i.test(txt)) return "stl";
  if (/^\s*(;|G\d|M\d|T\d)/m.test(txt) && /(^|\n)\s*(G[0-3]\b|M10[49]\b|;\s*(FLAVOR|HEADER_BLOCK_START|generated by))/i.test(txt)) return "gcode";
  if (/^\s*v\s+-?\d/m.test(txt) && /^\s*f\s+\d/m.test(txt)) return "obj";
  return "desconhecido";
}

function vazia(tipo: TipoArquivo): Extracao {
  return { tipo, fatiado: false, nome: null, fatiador: null, impressora: null, bico_mm: null, altura_camada_mm: null, preenchimento: null, suportes: null, placas: [], objetos: null,
    filamentos: [], tempo_total_min: null, peso_total_g: null, designer: null, licenca: null, descricao: null, miniatura: null, configuracoes: {}, peso_inclui_purga_suporte: null, avisos: [] };
}

// ---------- G-code (cabeçalho e bloco de configuração) ----------
/** Lê os metadados de um G-code. `texto` pode ser só o início + o fim do arquivo. */
export function lerGcode(conteudo: string, ext: Extracao = vazia("gcode")): Extracao {
  const linha = (re: RegExp) => re.exec(conteudo)?.[1]?.trim() ?? null;
  const cfg: Record<string, string> = {};
  chavesValores(conteudo, true, (k, v) => { const c = k.toLowerCase(); if (k.length <= 60 && !(c in cfg)) cfg[c] = v.slice(0, 300); });
  const lista = (v: string | null | undefined) => (v ? v.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : []);

  ext.fatiador ??= texto(linha(/^;\s*(BambuStudio[^\n]*)$/im) || linha(/^;\s*generated by\s+([^\n]+)$/im) || linha(/^;\s*(OrcaSlicer[^\n]*)$/im) || (/;FLAVOR:/i.test(conteudo) ? "Cura" : null), 100);
  // tempo
  const tTotal = linha(/total estimated time:\s*([^;\n]+)/i) || linha(/estimated printing time \(normal mode\)\s*=\s*([^\n]+)/i) || linha(/^;TIME:(\d+)/m);
  ext.tempo_total_min ??= tempoEmMinutos(tTotal);
  // peso por filamento
  const pesos = (linha(/total filament weight \[g\]\s*:\s*([^\n]+)/i) || linha(/^;\s*filament used \[g\]\s*=\s*([^\n]+)/im) || "").split(",").map(num).filter((x): x is number => x != null);
  const metros = (linha(/total filament length \[mm\]\s*:\s*([^\n]+)/i) || linha(/^;\s*filament used \[mm\]\s*=\s*([^\n]+)/im) || "").split(",").map((x) => { const n = num(x); return n == null ? null : Math.round(n / 10) / 100; });
  const totalG = num(linha(/^;\s*total filament used \[g\]\s*=\s*([^\n]+)/im));
  const curaM = num(linha(/^;Filament used:\s*([\d.]+)m/m));
  const tipos = lista(cfg["filament_type"]); const cores = lista(cfg["filament_colour"] || cfg["filament_color"]); const perfis = lista(cfg["filament_settings_id"]?.replace(/"/g, ""));
  const n = Math.max(pesos.length, tipos.length, curaM != null ? 1 : 0);
  if (!ext.filamentos.length && n) {
    ext.filamentos = Array.from({ length: n }, (_, i) => ({ slot: i + 1, tipo: texto(tipos[i] ?? (n === 1 ? tipos[0] : null), 40), cor: cor(cores[i]), peso_g: pesos[i] ?? null,
      metros: metros[i] ?? (i === 0 ? curaM : null), perfil: texto(perfis[i], 80) }))
      // multimaterial: o fatiador lista todos os filamentos do perfil; ficam só os usados
      .filter((f) => n === 1 || f.peso_g == null || f.peso_g > 0);
  }
  ext.peso_total_g ??= totalG ?? (pesos.length ? Math.round(pesos.reduce((s, x) => s + x, 0) * 100) / 100 : null);
  ext.impressora ??= texto(cfg["printer_model"] || cfg["printer_settings_id"]?.replace(/"/g, "") || linha(/^;MACHINE_TYPE:([^\n]+)/m), 100);
  ext.bico_mm ??= num(lista(cfg["nozzle_diameter"])[0]);
  ext.altura_camada_mm ??= num(cfg["layer_height"] ?? linha(/^;Layer height:\s*([\d.]+)/m));
  ext.preenchimento ??= texto(cfg["sparse_infill_density"] || cfg["fill_density"], 20);
  if (ext.suportes == null) { const s = cfg["enable_support"] ?? cfg["support_material"]; if (s != null) ext.suportes = /^(1|true)$/i.test(s); }
  if (ext.peso_inclui_purga_suporte == null && ext.peso_total_g != null) ext.peso_inclui_purga_suporte = true;
  for (const k of ["layer_height", "sparse_infill_density", "wall_loops", "top_shell_layers", "bottom_shell_layers", "enable_support", "support_type", "enable_prime_tower",
    "print_settings_id", "printer_settings_id", "nozzle_diameter", "filament_settings_id", "curr_bed_type", "fill_density", "perimeters"]) if (cfg[k] && !(k in ext.configuracoes)) ext.configuracoes[k] = cfg[k].replace(/"/g, "").slice(0, 120);
  if (ext.tipo === "gcode") { ext.fatiado = ext.tempo_total_min != null || ext.peso_total_g != null; if (ext.placas.length === 0 && ext.fatiado) ext.placas = [{ indice: 1, nome: null, tempo_min: ext.tempo_total_min, peso_g: ext.peso_total_g, objetos: [], filamentos: ext.filamentos, suportes: ext.suportes, miniatura: null }]; }
  if (!ext.fatiado && ext.tipo === "gcode") ext.avisos.push("O G-code não traz tempo nem peso no cabeçalho: preencha à mão.");
  return ext;
}

// ---------- 3MF (Bambu Studio / Orca) ----------
export function lerTresmf(bytes: Uint8Array, nomeArquivo = ""): Extracao {
  // 1) inspeciona o índice sem descompactar nada
  const entradas: { name: string; size: number; originalSize: number }[] = [];
  try {
    unzipSync(bytes, { filter: (f) => { entradas.push({ name: f.name, size: f.size, originalSize: f.originalSize }); return false; } });
  } catch { throw new Error("Arquivo 3MF corrompido ou incompleto (não é um ZIP válido)"); }
  if (entradas.length > LIMITES.entradasZip) throw new Error("3MF com arquivos internos demais");
  const quer = (n: string) => /^Metadata\/(slice_info\.config|project_settings\.config|model_settings\.config|plate_\d+\.(png|json)|thumbnail\.png)$/i.test(n)
    || /^3D\/3dmodel\.model$/i.test(n) || /^Auxiliaries\/\.thumbnails\/thumbnail_3mf\.png$/i.test(n);
  let total = 0;
  for (const e of entradas) {
    if (!quer(e.name)) continue;
    const lim = /\.png$/i.test(e.name) ? LIMITES.imagemMax : /3dmodel\.model$/i.test(e.name) ? LIMITES.modeloMax : LIMITES.configMax;
    if (e.originalSize > lim) throw new Error(`Parte interna grande demais (${e.name})`);
    if (e.size > 0 && e.originalSize / e.size > LIMITES.razaoMax && e.originalSize > 1048576) throw new Error("Compactação suspeita (possível zip bomb): arquivo recusado");
    total += e.originalSize;
  }
  if (total > LIMITES.totalDescompactado) throw new Error("Conteúdo descompactado grande demais");
  const tipo: TipoArquivo = entradas.some((e) => /^Metadata\/plate_\d+\.gcode$/i.test(e.name)) ? "gcode.3mf" : "3mf";
  const ext = vazia(tipo);
  let arq: Record<string, Uint8Array>;
  try { arq = unzipSync(bytes, { filter: (f) => quer(f.name) }); } catch { throw new Error("Não foi possível descompactar o 3MF"); }
  // o tamanho real tem que bater com o declarado
  for (const [k, v] of Object.entries(arq)) { const d = entradas.find((e) => e.name === k); if (d && v.length > d.originalSize + 16) throw new Error("3MF inconsistente: recusado"); }
  const ler = (re: RegExp) => { const k = Object.keys(arq).find((n) => re.test(n)); return k ? strFromU8(arq[k]) : null; };

  // modelo: título, autor, licença, aplicativo
  const modelo = ler(/^3D\/3dmodel\.model$/i);
  if (modelo) {
    const meta: Record<string, string> = {};
    for (const [, k, v] of modelo.slice(0, 200000).matchAll(/<metadata\s+name="([^"]+)"[^>]*>([^<]*)<\/metadata>/g)) meta[k] = desescapar(v);
    ext.nome = texto(meta.Title, 200); ext.designer = texto(meta.Designer, 150); ext.licenca = texto(meta.License, 100);
    ext.descricao = texto(meta.Description?.replace(/<[^>]+>/g, " "), 2000); ext.fatiador = texto(meta.Application, 100);
  }
  // configuração do projeto (JSON nas versões atuais; "chave = valor" nas antigas)
  const proj = ler(/^Metadata\/project_settings\.config$/i);
  let cfg: Record<string, unknown> = {};
  if (proj) {
    try { cfg = JSON.parse(proj); } catch { chavesValores(proj, false, (k, v) => { if (/^\w+$/.test(k)) cfg[k] = v; }); }
  }
  const val = (k: string) => { const v = cfg[k]; return Array.isArray(v) ? v.map(String) : v == null ? [] : String(v).split(/[;]/); };
  const tiposCfg = val("filament_type"), coresCfg = val("filament_colour"), perfisCfg = val("filament_settings_id");
  ext.impressora = texto(val("printer_model")[0] || val("printer_settings_id")[0], 100);
  ext.bico_mm = num(val("nozzle_diameter")[0]);
  ext.altura_camada_mm = num(val("layer_height")[0]);
  ext.preenchimento = texto(val("sparse_infill_density")[0], 20);
  const sup = val("enable_support")[0]; if (sup != null) ext.suportes = /^(1|true)$/i.test(sup);
  for (const k of ["print_settings_id", "printer_settings_id", "layer_height", "sparse_infill_density", "sparse_infill_pattern", "wall_loops", "top_shell_layers", "bottom_shell_layers",
    "enable_support", "support_type", "enable_prime_tower", "curr_bed_type", "nozzle_diameter", "filament_settings_id"]) {
    const v = val(k); if (v.length && v[0] !== "") ext.configuracoes[k] = v.join(", ").slice(0, 120);
  }

  // placas e objetos (projeto)
  const modelSet = ler(/^Metadata\/model_settings\.config$/i);
  const nomesObj: Record<string, string> = {};
  const placasProjeto: { indice: number; nome: string | null; objetos: string[] }[] = [];
  if (modelSet) {
    for (const { tag, corpo } of blocos(modelSet, "<object ", "</object>")) { const id = attrs(tag).id; const m = metadados(corpo.split(/<part\b/)[0]); if (id && m.name) nomesObj[id] = m.name; }
    for (const { corpo } of blocos(modelSet, "<plate>", "</plate>", 200)) {
      const m = metadados(corpo.split(/<model_instance>/)[0]);
      const objs = blocos(corpo, "<model_instance>", "</model_instance>", 2000).map(({ corpo: mi }) => nomesObj[metadados(mi).object_id] || `Objeto ${metadados(mi).object_id}`);
      placasProjeto.push({ indice: Number(m.plater_id) || placasProjeto.length + 1, nome: texto(m.plater_name, 80), objetos: objs });
    }
  }
  // fatiamento: tempo, peso e filamentos por placa
  const slice = ler(/^Metadata\/slice_info\.config$/i);
  if (slice) {
    const cab = Object.fromEntries(Array.from(slice.matchAll(/<header_item\b[^>]*>/g)).map((m) => attrs(m[0])).map((a) => [a.key, a.value]));
    if (cab["X-BBL-Client-Version"]) ext.fatiador = `Bambu Studio ${cab["X-BBL-Client-Version"]}`;
    for (const { corpo } of blocos(slice, "<plate>", "</plate>", 200)) {
      const m = metadados(corpo);
      const idx = Number(m.index) || ext.placas.length + 1;
      const objetos = Array.from(corpo.matchAll(/<object\b[^>]*>/g)).map((o) => attrs(o[0])).filter((a) => a.skipped !== "true").map((a) => a.name || "Objeto");
      const fils: Filamento[] = Array.from(corpo.matchAll(/<filament\b[^>]*>/g)).map((f) => attrs(f[0])).map((a) => ({
        slot: Number(a.id) || 1, tipo: texto(a.type, 40), cor: cor(a.color), peso_g: num(a.used_g), metros: num(a.used_m), perfil: texto(perfisCfg[(Number(a.id) || 1) - 1]?.replace(/"/g, ""), 80) }));
      const tempo = num(m.prediction);
      ext.placas.push({ indice: idx, nome: placasProjeto.find((p) => p.indice === idx)?.nome ?? null, tempo_min: tempo != null ? Math.round((tempo / 60) * 10) / 10 : null,
        peso_g: num(m.weight) ?? (fils.length ? Math.round(fils.reduce((s, f) => s + (f.peso_g || 0), 0) * 100) / 100 : null),
        objetos: objetos.length ? objetos : placasProjeto.find((p) => p.indice === idx)?.objetos ?? [], filamentos: fils,
        suportes: m.support_used != null ? m.support_used === "true" : null, miniatura: arq[`Metadata/plate_${idx}.png`] ?? null });
    }
    ext.fatiado = ext.placas.some((p) => p.tempo_min != null || p.peso_g != null);
    if (ext.fatiado) ext.peso_inclui_purga_suporte = true;
  }
  if (!ext.placas.length && placasProjeto.length) {
    ext.placas = placasProjeto.map((p) => ({ indice: p.indice, nome: p.nome, tempo_min: null, peso_g: null, objetos: p.objetos, filamentos: [], suportes: null, miniatura: arq[`Metadata/plate_${p.indice}.png`] ?? null }));
  }
  ext.placas.sort((a, b) => a.indice - b.indice);
  // totais
  const comTempo = ext.placas.filter((p) => p.tempo_min != null);
  ext.tempo_total_min = comTempo.length ? Math.round(comTempo.reduce((s, p) => s + (p.tempo_min || 0), 0) * 10) / 10 : null;
  const comPeso = ext.placas.filter((p) => p.peso_g != null);
  ext.peso_total_g = comPeso.length ? Math.round(comPeso.reduce((s, p) => s + (p.peso_g || 0), 0) * 100) / 100 : null;
  ext.objetos = ext.placas.length ? ext.placas.reduce((s, p) => s + p.objetos.length, 0) || (Object.keys(nomesObj).length || null) : Object.keys(nomesObj).length || null;
  // filamentos somados por slot
  const porSlot = new Map<number, Filamento>();
  for (const f of ext.placas.flatMap((p) => p.filamentos)) {
    const a = porSlot.get(f.slot);
    if (!a) porSlot.set(f.slot, { ...f });
    else { a.peso_g = (a.peso_g ?? 0) + (f.peso_g ?? 0); a.metros = (a.metros ?? 0) + (f.metros ?? 0); }
  }
  ext.filamentos = Array.from(porSlot.values()).map((f) => ({ ...f, peso_g: f.peso_g != null ? Math.round(f.peso_g * 100) / 100 : null, metros: f.metros != null ? Math.round(f.metros * 100) / 100 : null })).sort((a, b) => a.slot - b.slot);
  if (!ext.filamentos.length && tiposCfg.length) {
    // projeto não fatiado: só sabemos quais filamentos estão configurados (sem consumo)
    ext.filamentos = tiposCfg.map((t, i) => ({ slot: i + 1, tipo: texto(t, 40), cor: cor(coresCfg[i]), peso_g: null, metros: null, perfil: texto(perfisCfg[i]?.replace(/"/g, ""), 80) }));
  }
  ext.miniatura = ext.placas.find((p) => p.miniatura)?.miniatura ?? arq["Metadata/thumbnail.png"] ?? arq["Auxiliaries/.thumbnails/thumbnail_3mf.png"] ?? null;
  ext.nome ??= texto(nomeArquivo.replace(/(\.gcode)?\.3mf$/i, ""), 200);
  if (!ext.fatiado) ext.avisos.push(tipo === "3mf" ? "Projeto não fatiado: tempo e consumo não estão no arquivo. Fatie no Bambu Studio e exporte \"Exportar arquivo de placa fatiada (.gcode.3mf)\", ou preencha à mão." : "O arquivo não trouxe tempo/peso das placas.");
  return ext;
}

/** Junta o resultado do G-code dentro do 3MF quando o slice_info não existe */
export function vaziaDe(tipo: TipoArquivo) { return vazia(tipo); }
