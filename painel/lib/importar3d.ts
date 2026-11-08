"use client";
import { strFromU8 } from "fflate";
import { analisarModelo, type Analise } from "./modelo3d";
import { detectarTipo, lerGcode, lerTresmf, vaziaDe, LIMITES, type Extracao } from "./projeto3d";

export type Importado = Extracao & { arquivo: File; sha256: string; geometria: Analise | null };

const ler = (f: Blob) => f.arrayBuffer().then((b) => new Uint8Array(b));

/** SHA-256 do arquivo (evita importar o mesmo projeto duas vezes) */
export async function hashArquivo(f: File) {
  const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Processa o arquivo no navegador: nada é enviado antes de o usuário confirmar */
export async function importarArquivo(arquivo: File): Promise<Importado> {
  if (arquivo.size === 0) throw new Error("Arquivo vazio");
  if (arquivo.size > LIMITES.arquivoMax) throw new Error("Arquivo maior que 200 MB");
  const cabeca = await ler(arquivo.slice(0, 64 * 1024));
  let tipo = detectarTipo(cabeca, arquivo.size);
  let ext: Extracao;
  if (tipo === "3mf") {
    ext = lerTresmf(await ler(arquivo), arquivo.name);
  } else if (tipo === "gcode") {
    if (arquivo.size > LIMITES.gcodeMax) throw new Error("G-code maior que 120 MB");
    // metadados ficam no começo (Bambu) ou no fim (Orca/Prusa): lê só as pontas
    const ini = strFromU8(await ler(arquivo.slice(0, 1024 * 1024)), true);
    const fim = arquivo.size > 2 * 1024 * 1024 ? strFromU8(await ler(arquivo.slice(arquivo.size - 1024 * 1024)), true) : strFromU8(await ler(arquivo.slice(1024 * 1024)), true);
    ext = lerGcode(ini + "\n" + fim, vaziaDe("gcode"));
    ext.nome = arquivo.name.replace(/\.gcode$/i, "");
  } else if (tipo === "stl" || tipo === "obj" || tipo === "step") {
    ext = vaziaDe(tipo);
    ext.nome = arquivo.name.replace(/\.(stl|obj|step|stp)$/i, "");
    ext.avisos.push("Arquivo de geometria: tempo e consumo dependem do fatiamento. Preencha à mão ou importe o .gcode.3mf.");
  } else {
    throw new Error("Tipo de arquivo não reconhecido. Envie .gcode.3mf, .3mf, .gcode ou .stl");
  }
  tipo = ext.tipo;
  let geometria: Analise | null = null;
  if (tipo === "stl" || tipo === "3mf" || tipo === "gcode.3mf") {
    try { geometria = await analisarModelo(new File([arquivo], tipo === "stl" ? "x.stl" : "x.3mf")); } catch { /* geometria é opcional */ }
  }
  return { ...ext, arquivo, sha256: await hashArquivo(arquivo), geometria };
}

/** Sugere o cadastro de matéria-prima mais parecido (tipo + cor) */
const CORES_NOMES: Record<string, string> = {
  preto: "#000000", branco: "#FFFFFF", cinza: "#808080", prata: "#C0C0C0", vermelho: "#FF0000", azul: "#0047AB", verde: "#008000", amarelo: "#FFD700",
  laranja: "#FF8C00", rosa: "#FF69B4", roxo: "#800080", marrom: "#8B4513", bege: "#F5F5DC", dourado: "#D4AF37", transparente: "#F0F0F0", natural: "#F2EAD3",
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distancia = (a: string, b: string) => { const [x, y] = [rgb(a), rgb(b)]; return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0)); };
export type MatCadastro = { id: string; nome: string; cor: string | null; material: string | null; categoria: string; unidade: string; custo_medio: number; peso_liquido_g: number | null; quantidade: number; quantidade_reservada: number };
export function sugerirMaterial(tipo: string | null, corHex: string | null, mats: MatCadastro[]): MatCadastro | null {
  const t = (tipo || "").toLowerCase().replace(/[^a-z]/g, "");
  const candidatos = mats.filter((m) => {
    const mt = `${m.material || ""} ${m.nome}`.toLowerCase().replace(/[^a-z ]/g, "");
    return t ? mt.split(/\s+/).some((p) => p === t || p.startsWith(t)) || mt.includes(t) : ["filamento", "resina"].includes(m.categoria);
  });
  if (!candidatos.length) return null;
  if (!corHex || !/^#[0-9A-F]{6}$/i.test(corHex)) return candidatos[0];
  const corDe = (m: MatCadastro) => {
    const c = (m.cor || "").toLowerCase();
    if (/^#?[0-9a-f]{6}$/.test(c)) return c.startsWith("#") ? c.toUpperCase() : `#${c.toUpperCase()}`;
    const k = Object.keys(CORES_NOMES).find((n) => c.includes(n));
    return k ? CORES_NOMES[k] : null;
  };
  return candidatos.map((m) => ({ m, d: corDe(m) ? distancia(corHex, corDe(m)!) : 999 })).sort((a, b) => a.d - b.d)[0].m;
}
/** preço por kg do cadastro (mesma regra do servidor) */
export function precoKg(m: MatCadastro | null | undefined) {
  if (!m) return 0;
  const f = ({ kg: 1000, g: 1, l: 1000, ml: 1 } as Record<string, number>)[m.unidade.toLowerCase()] ?? (["bobina", "un", "rolo"].includes(m.unidade.toLowerCase()) ? m.peso_liquido_g || 0 : 0);
  return f > 0 ? (m.custo_medio / f) * 1000 : 0;
}
