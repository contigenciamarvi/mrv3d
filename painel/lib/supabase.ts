"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A configuração vem de /config.js (gerado no servidor), para trocar o banco sem recompilar.
declare global {
  interface Window { __CFG?: { url: string; key: string } }
}

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (client) return client;
  const cfg = typeof window !== "undefined" ? window.__CFG : undefined;
  const url = cfg?.url || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost";
  const key = cfg?.key || process.env.NEXT_PUBLIC_SUPABASE_KEY || "sem-chave";
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "mrv3d-painel" },
  });
  return client;
}

// Toda autorização acontece no banco (RLS + funções que conferem o perfil do usuário).
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** select que lança erro em vez de devolver {error} */
export async function q<T = Record<string, unknown>>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Envia arquivo para o storage privado da empresa: {empresa}/{pasta}/{uuid}-{nome} */
export async function enviarArquivo(empresa: string, pasta: string, arquivo: File) {
  const nome = arquivo.name.normalize("NFD").replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${empresa}/${pasta}/${crypto.randomUUID()}-${nome}`;
  const { error } = await sb().storage.from("empresa").upload(path, arquivo, { upsert: false, contentType: arquivo.type || "application/octet-stream" });
  if (error) throw new Error(/row-level|policy/i.test(error.message) ? "Arquivo recusado: tipo não permitido ou limite de armazenamento do plano atingido" : error.message);
  return path;
}
/** URL temporária (10 min) para abrir/baixar um arquivo privado */
export async function urlTemporaria(path: string, segundos = 600) {
  const { data, error } = await sb().storage.from("empresa").createSignedUrl(path, segundos);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
