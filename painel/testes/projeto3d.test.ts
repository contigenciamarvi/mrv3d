// Testes da leitura de projetos (rodar: npm run test:3d)
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { detectarTipo, lerGcode, lerTresmf, tempoEmMinutos, vaziaDe } from "../lib/projeto3d.ts";

const sliceInfo = (versao: string | null, placas: string) => `<?xml version="1.0" encoding="UTF-8"?>
<config>${versao ? `\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${versao}"/>\n  </header>` : ""}
${placas}
</config>`;
const placa = (i: number, seg: number, peso: number, objs: string[], fils: [number, string, string, number, number][], suporte = false) => `  <plate>
    <metadata key="index" value="${i}"/>
    <metadata key="prediction" value="${seg}"/>
    <metadata key="weight" value="${peso}"/>
    <metadata key="support_used" value="${suporte}"/>
${objs.map((o, k) => `    <object identify_id="${100 + k}" name="${o}" skipped="false" />`).join("\n")}
${fils.map(([id, t, c, m, g]) => `    <filament id="${id}" tray_info_idx="GFA00" type="${t}" color="${c}" used_m="${m}" used_g="${g}" />`).join("\n")}
  </plate>`;
const modelo = (titulo: string) => `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-01.09.07.52</metadata><metadata name="Title">${titulo}</metadata><metadata name="Designer">Ana &amp; Bia</metadata><metadata name="License">CC BY-NC</metadata>
 <resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices>
 <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources>
 <build><item objectid="1"/></build></model>`;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test("tempo em minutos", () => {
  assert.equal(tempoEmMinutos("1h 23m 45s"), 83.8);
  assert.equal(tempoEmMinutos("1d 2h"), 1560);
  assert.equal(tempoEmMinutos("5025"), 83.8);
  assert.equal(tempoEmMinutos(""), null);
  assert.equal(tempoEmMinutos("abc"), null);
});

test("gcode.3mf Bambu Studio 1.9: várias placas, vários materiais e cores", () => {
  const z = zipSync({
    "3D/3dmodel.model": strToU8(modelo("Organizador")),
    "Metadata/slice_info.config": strToU8(sliceInfo("01.09.07.52",
      placa(1, 5025, 20.5, ["Caixa", "Tampa"], [[1, "PLA", "#FFFFFFFF", 6.1, 15.3], [2, "PETG", "#000000", 2, 5.2]]) + "\n" +
      placa(2, 1800, 8, ["Divisória"], [[1, "PLA", "#FFFFFF", 2.5, 8]], true))),
    "Metadata/project_settings.config": strToU8(JSON.stringify({ printer_model: "Bambu Lab P1S", nozzle_diameter: ["0.4"], layer_height: "0.2", sparse_infill_density: "15%",
      enable_support: "0", filament_type: ["PLA", "PETG"], filament_colour: ["#FFFFFF", "#000000"], filament_settings_id: ["Bambu PLA Basic @BBL P1S", "Generic PETG"] })),
    "Metadata/plate_1.gcode": strToU8("; HEADER_BLOCK_START\n"), "Metadata/plate_1.png": png, "Metadata/plate_2.png": png,
  });
  const e = lerTresmf(z, "organizador.gcode.3mf");
  assert.equal(e.tipo, "gcode.3mf");
  assert.equal(e.fatiado, true);
  assert.equal(e.nome, "Organizador");
  assert.equal(e.designer, "Ana & Bia");
  assert.equal(e.licenca, "CC BY-NC");
  assert.equal(e.fatiador, "Bambu Studio 01.09.07.52");
  assert.equal(e.impressora, "Bambu Lab P1S");
  assert.equal(e.bico_mm, 0.4);
  assert.equal(e.altura_camada_mm, 0.2);
  assert.equal(e.placas.length, 2);
  assert.equal(e.placas[0].tempo_min, 83.8);
  assert.equal(e.placas[1].tempo_min, 30);
  assert.equal(e.tempo_total_min, 113.8);
  assert.equal(e.peso_total_g, 28.5);
  assert.equal(e.objetos, 3);
  assert.deepEqual(e.placas[0].objetos, ["Caixa", "Tampa"]);
  assert.equal(e.placas[1].suportes, true);
  assert.equal(e.filamentos.length, 2);
  assert.equal(e.filamentos[0].peso_g, 23.3); // somado das duas placas
  assert.equal(e.filamentos[0].cor, "#FFFFFF"); // alfa removido
  assert.equal(e.filamentos[1].tipo, "PETG");
  assert.equal(e.filamentos[0].perfil, "Bambu PLA Basic @BBL P1S");
  assert.equal(e.peso_inclui_purga_suporte, true);
  assert.ok(e.miniatura && e.miniatura.length === png.length);
});

test("versão antiga: sem cabeçalho de versão e config em chave = valor", () => {
  const z = zipSync({
    "Metadata/slice_info.config": strToU8(sliceInfo(null, placa(1, 600, 3.2, ["Peça"], [[1, "PLA", "#FF0000", 1, 3.2]]))),
    "Metadata/project_settings.config": strToU8("layer_height = 0.16\nprinter_model = Bambu Lab X1 Carbon\nfilament_type = PLA\n"),
    "Metadata/plate_1.gcode": strToU8(";\n"),
  });
  const e = lerTresmf(z, "peca.gcode.3mf");
  assert.equal(e.nome, "peca");
  assert.equal(e.altura_camada_mm, 0.16);
  assert.equal(e.impressora, "Bambu Lab X1 Carbon");
  assert.equal(e.tempo_total_min, 10);
  assert.equal(e.fatiador, null);
});

test("3mf não fatiado: placas e objetos do projeto, sem inventar tempo/peso", () => {
  const z = zipSync({
    "3D/3dmodel.model": strToU8(modelo("Robo")),
    "Metadata/model_settings.config": strToU8(`<config><object id="2"><metadata key="name" value="Cabeça"/><part id="1"><metadata key="name" value="parte"/></part></object>
<object id="3"><metadata key="name" value="Corpo"/></object>
<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Principal"/><model_instance><metadata key="object_id" value="2"/></model_instance><model_instance><metadata key="object_id" value="3"/></model_instance></plate></config>`),
    "Metadata/project_settings.config": strToU8(JSON.stringify({ filament_type: ["PLA", "PLA"], filament_colour: ["#00FF00", "#0000FF"] })),
  });
  const e = lerTresmf(z, "robo.3mf");
  assert.equal(e.tipo, "3mf");
  assert.equal(e.fatiado, false);
  assert.equal(e.tempo_total_min, null);
  assert.equal(e.peso_total_g, null);
  assert.equal(e.placas.length, 1);
  assert.equal(e.placas[0].nome, "Principal");
  assert.deepEqual(e.placas[0].objetos, ["Cabeça", "Corpo"]);
  assert.equal(e.filamentos.length, 2);
  assert.equal(e.filamentos[0].peso_g, null);
  assert.ok(e.avisos.length > 0);
});

test("3mf malformado e zip bomb são recusados", () => {
  assert.throws(() => lerTresmf(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0]), "x.3mf"), /corrompido|ZIP/);
  const bomba = zipSync({ "Metadata/slice_info.config": new Uint8Array(25 * 1048576) }, { level: 9 });
  assert.throws(() => lerTresmf(bomba, "b.3mf"), /grande demais|suspeita/);
  const razao = zipSync({ "Metadata/project_settings.config": new Uint8Array(10 * 1048576) }, { level: 9 });
  assert.throws(() => lerTresmf(razao, "r.3mf"), /suspeita/);
});

test("G-code Bambu Studio (cabeçalho, dois filamentos)", () => {
  const g = `; HEADER_BLOCK_START
; BambuStudio 01.08.04.51
; model printing time: 1h 10m 5s; total estimated time: 1h 15m 30s
; total layer number: 120
; total filament length [mm] : 5120.10,1000.00
; total filament weight [g] : 15.45,3.05
; HEADER_BLOCK_END
; CONFIG_BLOCK_START
; layer_height = 0.2
; filament_type = PLA;PETG
; filament_colour = #FFFFFF;#112233
; printer_model = Bambu Lab A1
; nozzle_diameter = 0.4
; sparse_infill_density = 20%
; enable_support = 1
; CONFIG_BLOCK_END
G28
`;
  assert.equal(detectarTipo(new TextEncoder().encode(g), g.length), "gcode");
  const e = lerGcode(g, vaziaDe("gcode"));
  assert.equal(e.fatiado, true);
  assert.equal(e.fatiador, "BambuStudio 01.08.04.51");
  assert.equal(e.tempo_total_min, 75.5);
  assert.equal(e.peso_total_g, 18.5);
  assert.equal(e.filamentos.length, 2);
  assert.equal(e.filamentos[1].cor, "#112233");
  assert.equal(e.filamentos[0].metros, 5.12);
  assert.equal(e.impressora, "Bambu Lab A1");
  assert.equal(e.suportes, true);
});

test("G-code Prusa/Orca (dados no fim) e Cura", () => {
  const prusa = `G1 X1\n; filament used [mm] = 1234.5\n; filament used [g] = 3.71\n; total filament used [g] = 3.71\n; estimated printing time (normal mode) = 45m 12s\n; filament_type = PETG\n; layer_height = 0.15\n; generated by PrusaSlicer 2.7.1\n`;
  const e = lerGcode(prusa, vaziaDe("gcode"));
  assert.equal(e.tempo_total_min, 45.2);
  assert.equal(e.peso_total_g, 3.71);
  assert.equal(e.filamentos[0].tipo, "PETG");
  const cura = ";FLAVOR:Marlin\n;TIME:3600\n;Filament used: 2.5m\n;Layer height: 0.12\nG28\n";
  const c = lerGcode(cura, vaziaDe("gcode"));
  assert.equal(c.fatiador, "Cura");
  assert.equal(c.tempo_total_min, 60);
  assert.equal(c.peso_total_g, null); // Cura não informa peso: não inventa
  assert.equal(c.filamentos[0].metros, 2.5);
});

test("G-code sem metadados e detecção de STL/STEP/OBJ", () => {
  const e = lerGcode("G28\nG1 X10\n", vaziaDe("gcode"));
  assert.equal(e.fatiado, false);
  assert.ok(e.avisos.length);
  const stl = new Uint8Array(84 + 50); new DataView(stl.buffer).setUint32(80, 1, true);
  assert.equal(detectarTipo(stl, stl.length), "stl");
  assert.equal(detectarTipo(new TextEncoder().encode("solid x\n facet normal 0 0 1\n"), 30), "stl");
  assert.equal(detectarTipo(new TextEncoder().encode("ISO-10303-21;\nHEADER;"), 20), "step");
  assert.equal(detectarTipo(new TextEncoder().encode("v 0 0 0\nv 1 0 0\nf 1 2 3\n"), 30), "obj");
  assert.equal(detectarTipo(new TextEncoder().encode("olá mundo"), 9), "desconhecido");
});

test("arquivo malicioso não trava a leitura (sem retrocesso quadrático)", () => {
  const inicio = Date.now();
  const longo = "; " + "a ".repeat(1_000_000) + "\nG1 X1\n";
  lerGcode(longo);
  const semFechar = "<config>" + '<object id="1">'.repeat(200_000) + "<plate>".repeat(100_000) + "</config>";
  const zip = zipSync({ "Metadata/model_settings.config": strToU8(semFechar), "Metadata/slice_info.config": strToU8("<plate>".repeat(300_000)),
    "Metadata/project_settings.config": strToU8("x".repeat(3_000_000)), "3D/3dmodel.model": strToU8("<model/>") }, { level: 0 });
  lerTresmf(zip, "ataque.3mf");
  assert.ok(Date.now() - inicio < 3000, `levou ${Date.now() - inicio} ms`);
});
