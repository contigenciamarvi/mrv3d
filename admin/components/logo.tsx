// Identidade MRV 3D Solutions: ícone de camadas dourado + "MRV" com o V prateado.
import { useId } from "react";

const OURO = ["#F8E3A1", "#D4AF37", "#A67C1B"];

/** Ícone (três camadas de impressão). Use em quadrados: ícone da aba, menu, avatar. */
export function LogoIcone({ className = "h-8 w-8", titulo }: { className?: string; titulo?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 200 200" className={className} role={titulo ? "img" : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={OURO[0]} /><stop offset=".5" stopColor={OURO[1]} /><stop offset="1" stopColor={OURO[2]} /></linearGradient>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C9A030" /><stop offset="1" stopColor="#8A6516" /></linearGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E9C766" /><stop offset="1" stopColor="#B08A24" /></linearGradient>
      </defs>
      <path fillRule="evenodd" fill={`url(#t${id})`} d="M100 26 L172 60 L100 94 L28 60 Z M100 46 L130 60 L100 74 L70 60 Z" />
      <path fill={`url(#l${id})`} d="M28 60 L100 94 L100 108 L28 74 Z" />
      <path fill={`url(#r${id})`} d="M172 60 L100 94 L100 108 L172 74 Z" />
      <path fill={`url(#t${id})`} d="M28 92 L100 126 L172 92 L172 106 L100 140 L28 106 Z" />
      <path fill={`url(#t${id})`} d="M28 124 L100 158 L172 124 L172 138 L100 172 L28 138 Z" />
    </svg>
  );
}

/** "MRV" (M e R dourados, V com a perna direita prateada) */
export function LogoMRV({ altura = 24, claro = false }: { altura?: number; claro?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 420 120" width={altura * 3.5} height={altura} role="img" aria-label="MRV">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={OURO[0]} /><stop offset=".45" stopColor={OURO[1]} /><stop offset="1" stopColor="#9C7A1E" /></linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="1">{claro
          ? <><stop offset="0" stopColor="#52525B" /><stop offset="1" stopColor="#18181B" /></>
          : <><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#B8BCC4" /></>}</linearGradient>
      </defs>
      <path fill={`url(#g${id})`} d="M0 116 V4 H30 L66 62 L102 4 H132 V116 H104 V52 L72 102 H60 L28 52 V116 Z" />
      <path fill={`url(#g${id})`} fillRule="evenodd" d="M150 116 V4 H214 C244 4 262 20 262 44 C262 62 252 75 236 80 L266 116 H234 L208 84 H178 V116 Z M178 28 V60 H212 C226 60 234 54 234 44 C234 34 226 28 212 28 Z" />
      <path fill={`url(#g${id})`} d="M268 4 H298 L330 84 L330 116 L318 116 Z" />
      <path fill={`url(#s${id})`} d="M330 84 L362 4 H420 L372 116 H330 Z" />
    </svg>
  );
}

/** Logo horizontal: ícone + MRV + "3D SOLUTIONS". `claro` = sobre fundo claro. */
export function Logo({ claro = false, tamanho = "md" }: { claro?: boolean; tamanho?: "sm" | "md" | "lg" }) {
  const t = ({ sm: ["h-8 w-8", 16, "text-[7.5px] tracking-[0.28em]"], md: ["h-10 w-10", 20, "text-[9px] tracking-[0.3em]"], lg: ["h-14 w-14", 28, "text-[12px] tracking-[0.32em]"] } as const)[tamanho];
  return (
    <div className="flex items-center gap-2.5" role="img" aria-label="MRV 3D Solutions">
      <LogoIcone className={t[0]} />
      <div className="flex flex-col gap-1">
        <LogoMRV altura={t[1]} claro={claro} />
        <span className={`${t[2]} font-semibold leading-none ${claro ? "text-zinc-700" : "text-zinc-200"}`}>3D SOLUTIONS</span>
      </div>
    </div>
  );
}
