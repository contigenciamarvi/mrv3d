"use client";
import { useCallback, useEffect, useState } from "react";
import { erroMsg } from "./utils";

/** Carrega dados com estados de carregando/erro e função para recarregar */
export function useDados<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const executar = useCallback(fn, deps);
  const recarregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try { setDados(await executar()); } catch (e) { setErro(erroMsg(e)); } finally { setCarregando(false); }
  }, [executar]);
  useEffect(() => { recarregar(); }, [recarregar]);
  return { dados, setDados, carregando, erro, recarregar };
}

/** Lê ?param= da URL (export estático não tem rotas dinâmicas) */
export function useParam(nome: string) {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    const ler = () => setV(new URLSearchParams(window.location.search).get(nome));
    ler();
    window.addEventListener("popstate", ler);
    return () => window.removeEventListener("popstate", ler);
  }, [nome]);
  return v;
}

/** Executa uma ação com estado de "salvando" */
export function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const executar = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setOcupado(true);
    try { return await fn(); } finally { setOcupado(false); }
  }, []);
  return { ocupado, executar };
}
