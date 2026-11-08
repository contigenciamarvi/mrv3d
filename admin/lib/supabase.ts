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
  const url = cfg?.url || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = cfg?.key || process.env.NEXT_PUBLIC_SUPABASE_KEY || "";
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "mrv3d-superadmin" },
  });
  return client;
}

// Toda autorização acontece no banco (RLS + funções que conferem o perfil do usuário).
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
