// Testes da abertura de .zip com modelos 3D (rodar: npm run test:3d)
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { arquivos3dDoZip, ehZipComum, nome3mf } from "../lib/zip3d.ts";

const arquivo = (bytes: Uint8Array, nome: string) => new File([bytes as BlobPart], nome);
const stl = strToU8("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n");

test("zip com peças: só os arquivos 3D, o fatiado primeiro", async () => {
  const z = zipSync({ "modelo/leia.txt": strToU8("oi"), "modelo/foto.png": new Uint8Array(10), "modelo/base.stl": stl, "modelo/tampa.STL": stl,
    "modelo/projeto.gcode.3mf": zipSync({ "3D/3dmodel.model": strToU8("<model/>") }), "__MACOSX/modelo/._base.stl": stl });
  const f = arquivo(z, "caixa.zip");
  assert.equal(await ehZipComum(f), true);
  const lista = await arquivos3dDoZip(f);
  assert.deepEqual(lista.map((x) => x.name), ["projeto.gcode.3mf", "base.stl", "tampa.STL"]);
});

test("3MF não é tratado como zip comum", async () => {
  const tresmf = zipSync({ "3D/3dmodel.model": strToU8("<model/>"), "[Content_Types].xml": strToU8("<Types/>") });
  assert.equal(await ehZipComum(arquivo(tresmf, "peca.3mf")), false);
  assert.equal(await ehZipComum(arquivo(tresmf, "sem-extensao")), false);
  assert.equal(await ehZipComum(arquivo(stl, "peca.stl")), false);
});

test("zip sem modelo 3D, zip bomb e zip corrompido são recusados", async () => {
  await assert.rejects(arquivos3dDoZip(arquivo(zipSync({ "a.txt": strToU8("x") }), "a.zip")), /não tem arquivos 3D/);
  const bomba = zipSync({ "grande.stl": new Uint8Array(30 * 1048576) }, { level: 9 });
  await assert.rejects(arquivos3dDoZip(arquivo(bomba, "b.zip")), /zip bomb/);
  await assert.rejects(arquivos3dDoZip(arquivo(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]), "c.zip")), /Não foi possível/);
});

test("3MF que chegou como .3mf.zip é tratado como 3MF", async () => {
  const tresmf = zipSync({ "3D/3dmodel.model": strToU8("<model/>"), "[Content_Types].xml": strToU8("<Types/>") });
  const f = arquivo(tresmf, "6_wands_X1.3mf.zip");
  assert.equal(await ehZipComum(f), false);
  assert.equal(nome3mf(f).name, "6_wands_X1.3mf");
  assert.equal(nome3mf(arquivo(tresmf, "projeto.zip")).name, "projeto.3mf");
});
