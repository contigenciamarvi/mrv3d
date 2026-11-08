"use client";
import { useEffect, useState } from "react";
import { useApp, PageHeader, Exige } from "@/components/shell";
import { useParam } from "@/lib/hooks";
import { Tabs } from "@/components/ui";
import { Biblioteca, Importador, MakerWorld } from "@/components/projetos";

type Aba = "biblioteca" | "importar" | "makerworld";
export default function Projetos() { return <Exige perm={["produtos_ver", "orcamentos_criar", "producao_gerenciar"]}><Conteudo /></Exige>; }

function Conteudo() {
  useApp();
  const id = useParam("id");
  const abaUrl = useParam("aba");
  const [aba, setAba] = useState<Aba>("biblioteca");
  useEffect(() => { if (abaUrl) setAba(abaUrl as Aba); }, [abaUrl]);
  return (
    <>
      <PageHeader titulo="Projetos 3D" sub="Biblioteca privada da empresa: arquivos do Bambu Studio, STL e referências do MakerWorld, prontos para orçamentos e produção" />
      <Tabs abas={[["biblioteca", "Biblioteca"], ["importar", "Importar projeto"], ["makerworld", "MakerWorld"]]} ativa={aba} onChange={setAba} />
      {aba === "biblioteca" && <Biblioteca abrir={id} />}
      {aba === "importar" && <Importador onPronto={() => setAba("biblioteca")} />}
      {aba === "makerworld" && <MakerWorld />}
    </>
  );
}
