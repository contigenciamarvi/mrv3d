// Arquivos .zip com modelos 3D (como vêm do MakerWorld, Printables, Thingiverse ou do cliente).
// Abre no navegador, com as mesmas proteções contra "zip bomb" da leitura de 3MF.
import { unzipSync } from "fflate";

export const EXT_3D = ["gcode.3mf", "3mf", "gcode", "stl", "obj", "step", "stp"];
const extensao = (n: string) => { const l = n.toLowerCase(); return l.endsWith(".gcode.3mf") ? "gcode.3mf" : l.split(".").pop() || ""; };
export const eh3d = (nome: string) => EXT_3D.includes(extensao(nome));

const LIM = { entradas: 2000, arquivos3d: 200, porArquivo: 200 * 1048576, total: 400 * 1048576, razao: 1000 };

/** .zip comum (não um 3MF, que também é zip por dentro)? Olha o conteúdo, não só o nome. */
export async function ehZipComum(f: File): Promise<boolean> {
  const c = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  if (!(c[0] === 0x50 && c[1] === 0x4b && c[2] === 0x03 && c[3] === 0x04)) return false;
  if (/\.zip$/i.test(f.name)) return true;
  if (/\.3mf$/i.test(f.name)) return false;
  return !(await entradas(f)).some((e) => /^3D\/3dmodel\.model$/i.test(e.nome));
}

type Entrada = { nome: string; comprimido: number; tamanho: number };
async function entradas(f: File): Promise<Entrada[]> {
  const lista: Entrada[] = [];
  try {
    unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => { lista.push({ nome: e.name, comprimido: e.size, tamanho: e.originalSize }); return false; } });
  } catch { throw new Error("Não foi possível abrir o .zip (arquivo corrompido ou protegido por senha)"); }
  return lista;
}

/** Extrai só os arquivos 3D do .zip (ignora pastas, imagens, PDFs e lixo do macOS). */
export async function arquivos3dDoZip(f: File): Promise<File[]> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const todas = await entradas(f);
  if (todas.length > LIM.entradas) throw new Error("O .zip tem arquivos demais");
  const quer = (n: string) => eh3d(n) && !n.endsWith("/") && !/(^|\/)(__MACOSX|\.)/.test(n);
  const alvo = todas.filter((e) => quer(e.nome));
  if (!alvo.length) throw new Error("O .zip não tem arquivos 3D (.gcode.3mf, .3mf, .gcode, .stl, .obj ou .step)");
  if (alvo.length > LIM.arquivos3d) throw new Error("O .zip tem arquivos 3D demais");
  let total = 0;
  for (const e of alvo) {
    if (e.tamanho > LIM.porArquivo) throw new Error(`"${e.nome}" passa de 200 MB`);
    if (e.comprimido > 0 && e.tamanho > 1048576 && e.tamanho / e.comprimido > LIM.razao) throw new Error("Compactação suspeita (possível zip bomb): arquivo recusado");
    total += e.tamanho;
  }
  if (total > LIM.total) throw new Error("Conteúdo do .zip grande demais (máximo 400 MB descompactado)");
  let saida: Record<string, Uint8Array>;
  try { saida = unzipSync(bytes, { filter: (e) => quer(e.name) }); } catch { throw new Error("Não foi possível descompactar o .zip"); }
  return Object.entries(saida).map(([nome, dados]) => {
    const d = alvo.find((e) => e.nome === nome);
    if (!d || dados.length > d.tamanho + 16) throw new Error("Arquivo .zip inconsistente: recusado");
    return new File([dados as BlobPart], nome.split("/").pop() || nome, { lastModified: f.lastModified });
  }).sort((a, b) => prioridade(a.name) - prioridade(b.name) || b.size - a.size);
}

// o mais útil primeiro: fatiado do Bambu, projeto 3MF, G-code, depois geometria
const prioridade = (n: string) => ["gcode.3mf", "3mf", "gcode", "stl", "obj", "step", "stp"].indexOf(extensao(n));
