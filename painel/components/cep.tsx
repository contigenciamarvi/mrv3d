"use client";
import { useRef, useState } from "react";
import { Field, Input } from "@/components/ui";

export type EnderecoCep = { endereco: string; cidade: string; uf: string };

const UFS_VALIDAS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);
const limpar = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

/** Busca o endereço do CEP (ViaCEP; se falhar, BrasilAPI). Devolve null se não existir. */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const n = cep.replace(/\D/g, "");
  if (n.length !== 8) return null;
  const montar = (rua: string, bairro: string, cidade: string, uf: string): EnderecoCep | null => {
    const u = limpar(uf, 2).toUpperCase();
    if (!cidade || !UFS_VALIDAS.has(u)) return null;
    return { endereco: [limpar(rua, 150), limpar(bairro, 80)].filter(Boolean).join(", "), cidade: limpar(cidade, 80), uf: u };
  };
  const comTempo = (url: string) => fetch(url, { signal: AbortSignal.timeout(6000), credentials: "omit", referrerPolicy: "no-referrer" });
  try {
    const r = await comTempo(`https://viacep.com.br/ws/${n}/json/`);
    if (r.ok) {
      const d = await r.json();
      if (d?.erro) return null;
      return montar(d.logradouro, d.bairro, d.localidade, d.uf);
    }
  } catch { /* tenta o outro serviço */ }
  try {
    const r = await comTempo(`https://brasilapi.com.br/api/cep/v1/${n}`);
    if (r.status === 404) return null;
    if (r.ok) { const d = await r.json(); return montar(d.street, d.neighborhood, d.city, d.state); }
  } catch { /* sem internet ou serviço fora */ }
  throw new Error("indisponivel");
}

export const formatarCep = (v: string) => { const n = v.replace(/\D/g, "").slice(0, 8); return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n; };

/** Campo de CEP que preenche endereço, cidade e estado ao digitar os 8 números. */
export function CampoCep({ value, onChange, onEndereco, disabled, label = "CEP" }:
  { value: string | null | undefined; onChange: (v: string) => void; onEndereco: (e: EnderecoCep) => void; disabled?: boolean; label?: string }) {
  const [aviso, setAviso] = useState<string | undefined>();
  const ultimo = useRef("");
  const mudar = async (bruto: string) => {
    const v = formatarCep(bruto);
    onChange(v);
    const n = v.replace(/\D/g, "");
    if (n.length !== 8) { setAviso(undefined); ultimo.current = ""; return; }
    if (n === ultimo.current) return;
    ultimo.current = n;
    setAviso("Buscando endereço…");
    try {
      const e = await buscarCep(n);
      if (ultimo.current !== n) return; // o usuário já digitou outro CEP
      if (!e) { setAviso("CEP não encontrado: preencha o endereço à mão"); return; }
      onEndereco(e);
      setAviso(e.endereco ? "Endereço preenchido: complete com o número" : "Cidade preenchida (CEP geral da cidade): informe a rua e o número");
    } catch {
      if (ultimo.current === n) setAviso("Não consegui consultar o CEP agora: preencha à mão");
    }
  };
  return (
    <Field label={label} hint={aviso}>
      <Input inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} disabled={disabled} value={value || ""} onChange={(e) => mudar(e.target.value)} />
    </Field>
  );
}
