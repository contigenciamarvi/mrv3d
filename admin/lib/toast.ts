"use client";
export type Toast = { id: number; msg: string; tipo: "ok" | "erro" };
export function toast(msg: string, tipo: "ok" | "erro" = "ok") {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: { id: Date.now() + Math.random(), msg, tipo } }));
}
export const erro = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "erro");
