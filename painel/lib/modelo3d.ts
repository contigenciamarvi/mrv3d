"use client";
import { unzipSync, strFromU8 } from "fflate";

export type Analise = { volume_cm3: number; triangulos: number; dimensoes_mm: [number, number, number]; formato: string; aviso?: string };

/** Volume pelo método dos tetraedros com sinal (malha fechada). Unidade da malha: mm. */
function volumeDe(tri: Float32Array | number[], n: number) {
  let v = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5], tri[o + 6], tri[o + 7], tri[o + 8]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    for (let k = 0; k < 9; k += 3) for (let e = 0; e < 3; e++) { const val = tri[o + k + e]; if (val < min[e]) min[e] = val; if (val > max[e]) max[e] = val; }
  }
  return { volume: Math.abs(v) / 1000, dim: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((x) => Math.round(x * 10) / 10) as [number, number, number] };
}

function stl(buf: ArrayBuffer): Analise {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const binario = buf.byteLength === 84 + n * 50;
  if (binario) {
    const tri = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) tri[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
    const r = volumeDe(tri, n);
    return { volume_cm3: r.volume, triangulos: n, dimensoes_mm: r.dim, formato: "STL binário" };
  }
  const txt = new TextDecoder().decode(buf);
  const nums = Array.from(txt.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)).flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const t = Math.floor(nums.length / 9);
  if (!t) throw new Error("Não foi possível ler o STL");
  const r = volumeDe(nums, t);
  return { volume_cm3: r.volume, triangulos: t, dimensoes_mm: r.dim, formato: "STL texto" };
}

function tresmf(buf: ArrayBuffer): Analise {
  const arquivos = unzipSync(new Uint8Array(buf), { filter: (f) => /\.model$/i.test(f.name) });
  const nome = Object.keys(arquivos).find((k) => /3dmodel\.model$/i.test(k)) || Object.keys(arquivos)[0];
  if (!nome) throw new Error("3MF sem modelo 3D");
  const xml = strFromU8(arquivos[nome]);
  const unidade = /unit="(\w+)"/.exec(xml)?.[1] || "millimeter";
  const escala = ({ micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 } as Record<string, number>)[unidade] || 1;
  // cada <mesh> tem seus próprios vértices
  let total = 0, tris = 0; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const malha of xml.split(/<mesh[\s>]/).slice(1)) {
    const vs = Array.from(malha.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)).map((m) => [Number(m[1]) * escala, Number(m[2]) * escala, Number(m[3]) * escala]);
    const ts = Array.from(malha.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)).map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const arr: number[] = [];
    for (const [a, b, c] of ts) arr.push(...vs[a], ...vs[b], ...vs[c]);
    const r = volumeDe(arr, ts.length);
    total += r.volume; tris += ts.length;
    for (const v of vs) for (let e = 0; e < 3; e++) { if (v[e] < min[e]) min[e] = v[e]; if (v[e] > max[e]) max[e] = v[e]; }
  }
  if (!tris) throw new Error("3MF sem malha legível");
  // o projeto pode trazer o tempo/peso do fatiador (Bambu/Orca/Prusa) — não confiamos sem conferir
  return { volume_cm3: total, triangulos: tris, dimensoes_mm: [0, 1, 2].map((e) => Math.round((max[e] - min[e]) * 10) / 10) as [number, number, number], formato: "3MF",
    aviso: "Se o 3MF veio do fatiador, o peso e o tempo reais estão no próprio fatiador — confira e digite os valores." };
}

export async function analisarModelo(arquivo: File): Promise<Analise> {
  const ext = arquivo.name.split(".").pop()?.toLowerCase();
  if (arquivo.size > 80 * 1024 * 1024) throw new Error("Arquivo muito grande para analisar no navegador (máx. 80 MB)");
  const buf = await arquivo.arrayBuffer();
  if (ext === "stl") return stl(buf);
  if (ext === "3mf") return tresmf(buf);
  throw new Error("A leitura automática funciona com STL e 3MF. Para OBJ/STEP, informe peso e tempo do fatiador.");
}

export const DENSIDADES: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, Nylon: 1.14, PC: 1.2, Resina: 1.12 };
export const densidadeDe = (material?: string | null) => {
  const m = (material || "").toLowerCase();
  const k = Object.keys(DENSIDADES).find((x) => m.includes(x.toLowerCase()));
  return k ? DENSIDADES[k] : 1.24;
};
