"use client";
import { useRef, useState } from "react";
import { FileArchive } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { arquivos3dDoZip, ehZipComum } from "@/lib/zip3d";

const tam = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Recebe o arquivo escolhido pelo usuário. Se for um .zip, abre, e:
 * um arquivo 3D dentro → devolve esse; vários → pergunta qual; cancelou → null.
 * Arquivo que não é .zip passa direto.
 */
export function useArquivoDoZip() {
  const [opcoes, setOpcoes] = useState<{ zip: string; arquivos: File[] } | null>(null);
  const resolver = useRef<((f: File | null) => void) | null>(null);

  const abrir = async (f: File): Promise<File | null> => {
    if (!(await ehZipComum(f))) return f;
    const arquivos = await arquivos3dDoZip(f);
    if (arquivos.length === 1) return arquivos[0];
    return new Promise((ok) => { resolver.current = ok; setOpcoes({ zip: f.name, arquivos }); });
  };
  const fechar = (f: File | null) => { resolver.current?.(f); resolver.current = null; setOpcoes(null); };

  const modal = opcoes && (
    <Modal aberto titulo="Qual arquivo do .zip?" onClose={() => fechar(null)} largura="max-w-lg">
      <p className="mb-3 text-sm text-slate-500"><FileArchive className="mr-1 inline h-4 w-4" />{opcoes.zip} tem {opcoes.arquivos.length} arquivos 3D. Escolha um (o .gcode.3mf fatiado traz tempo e peso).</p>
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {opcoes.arquivos.map((a, i) => (
          <li key={i}><button type="button" onClick={() => fechar(a)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
            <span className="min-w-0 truncate">{a.name}</span><span className="shrink-0 text-xs text-slate-500">{tam(a.size)}</span></button></li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => fechar(null)}>Cancelar</Button></div>
    </Modal>
  );
  return { abrir, modal };
}
