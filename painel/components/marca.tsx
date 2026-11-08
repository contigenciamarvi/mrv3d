"use client";
import { useEffect } from "react";
import { Calculator, Factory, Activity, Boxes, ShieldCheck } from "lucide-react";

const RECURSOS = [
  { icon: Calculator, titulo: "Orçamento automático", texto: "Importe o arquivo do Bambu Studio e veja custo, margem e preço na hora." },
  { icon: Factory, titulo: "Produção sob controle", texto: "Ordens de produção, fila por impressora e prazos de entrega." },
  { icon: Activity, titulo: "Impressoras ao vivo", texto: "Progresso, temperaturas e falhas das impressoras na rede da oficina." },
  { icon: Boxes, titulo: "Filamento sem surpresa", texto: "Estoque por material e cor, com baixa automática a cada impressão." },
];

/** Ilustração: peça sendo impressa em camadas, com o bico por cima */
function Impressao() {
  const camadas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <svg viewBox="0 0 320 220" className="h-auto w-full max-w-sm" aria-hidden="true">
      <defs>
        <linearGradient id="cam" x1="0" x2="1"><stop offset="0" stopColor="#60a5fa" /><stop offset="1" stopColor="#2563eb" /></linearGradient>
        <linearGradient id="mesa" x1="0" x2="1"><stop offset="0" stopColor="#334155" /><stop offset="1" stopColor="#1e293b" /></linearGradient>
      </defs>
      {/* mesa */}
      <rect x="30" y="182" width="260" height="10" rx="3" fill="url(#mesa)" />
      <rect x="40" y="192" width="240" height="4" rx="2" fill="#0f172a" opacity=".6" />
      {/* peça em camadas: vaso que vai afinando */}
      {camadas.map((i) => {
        const w = 150 - Math.abs(i - 4) * 10 - i * 3;
        const y = 172 - i * 11;
        return <rect key={i} x={160 - w / 2} y={y} width={w} height="9" rx="4.5" fill="url(#cam)" opacity={0.55 + i * 0.045}>
          <animate attributeName="opacity" values={`${0.55 + i * 0.045};1;${0.55 + i * 0.045}`} dur="3s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
        </rect>;
      })}
      {/* camada sendo depositada */}
      <rect x="130" y="62" width="0" height="9" rx="4.5" fill="#93c5fd">
        <animate attributeName="width" values="0;60;60;0" keyTimes="0;0.6;0.9;1" dur="3s" repeatCount="indefinite" />
      </rect>
      {/* bico */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="17 0;77 0;77 0;17 0" keyTimes="0;0.6;0.9;1" dur="3s" repeatCount="indefinite" />
        <rect x="96" y="14" width="34" height="22" rx="4" fill="#e2e8f0" />
        <rect x="104" y="36" width="18" height="8" fill="#cbd5e1" />
        <path d="M107 44 h12 l-4 7 h-4 z" fill="#f59e0b" />
        <circle cx="113" cy="53" r="2.2" fill="#fbbf24"><animate attributeName="opacity" values="1;.3;1" dur=".6s" repeatCount="indefinite" /></circle>
      </g>
      {/* trilho */}
      <rect x="20" y="20" width="280" height="6" rx="3" fill="#1e293b" />
    </svg>
  );
}

/** Tela de acesso (login, criar conta, criar empresa): marca e recursos à esquerda, formulário à direita */
export function TelaCentral({ children, sub }: { children: React.ReactNode; sub?: string }) {
  // telas de acesso são sempre claras (ao sair do sistema no modo escuro, a classe ficaria no <html>)
  useEffect(() => { document.documentElement.classList.remove("dark"); }, []);
  return (
    <div className="flex min-h-screen bg-white text-slate-900">
      {/* lado da marca */}
      <aside className="relative hidden w-[52%] flex-col justify-between overflow-hidden bg-slate-950 p-10 text-white lg:flex xl:p-14">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold shadow-lg shadow-blue-600/30">M3</div>
          <div><div className="font-semibold">MRV3D Solutions</div><div className="text-xs text-slate-400">Gestão para impressão 3D</div></div>
        </div>

        <div className="relative space-y-8">
          <div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight xl:text-4xl">Do arquivo fatiado ao pedido entregue, <span className="text-blue-400">tudo num lugar só.</span></h2>
            <p className="mt-3 max-w-md text-slate-400">O sistema de gestão feito para quem vive de impressão 3D.</p>
          </div>
          <Impressao />
          <ul className="grid max-w-xl gap-4 sm:grid-cols-2">
            {RECURSOS.map(({ icon: I, titulo, texto }) => (
              <li key={titulo} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10"><I className="h-4 w-4 text-blue-300" /></span>
                <span><span className="block text-sm font-medium">{titulo}</span><span className="block text-xs leading-relaxed text-slate-400">{texto}</span></span>
              </li>))}
          </ul>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4" /> Seus dados ficam separados por empresa e protegidos.</div>
      </aside>

      {/* formulário */}
      <main className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">M3</div>
          <div><div className="font-semibold">MRV3D Solutions</div><div className="text-xs text-slate-500">{sub || "Gestão para impressão 3D"}</div></div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {sub && <p className="mb-2 hidden text-sm font-medium text-blue-600 lg:block">{sub}</p>}
            {children}
          </div>
        </div>
        <footer className="px-6 py-4 text-center text-xs text-slate-400">© {new Date().getFullYear()} MRV3D Solutions · mrv3dsolutions.tech</footer>
      </main>
    </div>
  );
}
