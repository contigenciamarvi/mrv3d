"use client";
import { useRef, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { UFS } from "@/lib/utils";

export type EnderecoCep = { logradouro: string; bairro: string; cidade: string; uf: string };

const UFS_VALIDAS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);
const limpar = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

/** Busca o endereço do CEP (ViaCEP; se falhar, BrasilAPI). Devolve null se não existir. */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const n = cep.replace(/\D/g, "");
  if (n.length !== 8) return null;
  const montar = (rua: string, bairro: string, cidade: string, uf: string): EnderecoCep | null => {
    const u = limpar(uf, 2).toUpperCase();
    if (!cidade || !UFS_VALIDAS.has(u)) return null;
    return { logradouro: limpar(rua, 150), bairro: limpar(bairro, 100), cidade: limpar(cidade, 100), uf: u };
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
      setAviso(e.logradouro ? "Endereço preenchido: informe o número" : "Cidade preenchida (CEP geral da cidade): informe rua, número e bairro");
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

export type Endereco = { cep?: string | null; endereco?: string | null; numero_endereco?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null };

/** "Rua X, 123 - apto 4 - Bairro - Cidade/UF - CEP 00000-000" (pula o que estiver vazio) */
export function formatarEndereco(e: Endereco, comCep = true): string {
  const rua = [e.endereco, e.numero_endereco].filter(Boolean).join(", ");
  const cidade = [e.cidade, e.uf].filter(Boolean).join("/");
  return [rua, e.complemento, e.bairro, cidade, comCep && e.cep ? `CEP ${e.cep}` : null].filter(Boolean).join(" - ");
}

/** CEP, rua, número, complemento, bairro, cidade e estado. O CEP preenche rua, bairro, cidade e estado. */
export function CamposEndereco({ v, set, disabled }: { v: Endereco; set: (p: Endereco) => void; disabled?: boolean }) {
  const campo = (k: keyof Endereco, label: string, props: Record<string, unknown> = {}) => (
    <Field label={label}><Input disabled={disabled} value={v[k] || ""} onChange={(e) => set({ [k]: e.target.value })} {...props} /></Field>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <CampoCep disabled={disabled} value={v.cep} onChange={(cep) => set({ cep })}
          onEndereco={(e) => set({ endereco: e.logradouro || v.endereco || "", bairro: e.bairro || v.bairro || "", cidade: e.cidade, uf: e.uf })} />
        <div className="sm:col-span-2">{campo("endereco", "Rua / logradouro", { maxLength: 300, autoComplete: "address-line1" })}</div>
        {campo("numero_endereco", "Número", { maxLength: 20, placeholder: "ex.: 120 ou s/n" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {campo("complemento", "Complemento", { maxLength: 100, placeholder: "apto, bloco, sala" })}
        {campo("bairro", "Bairro", { maxLength: 100 })}
        {campo("cidade", "Cidade", { maxLength: 100 })}
        <Field label="Estado"><Select disabled={disabled} value={v.uf || ""} onChange={(e) => set({ uf: e.target.value })}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
    </div>
  );
}
