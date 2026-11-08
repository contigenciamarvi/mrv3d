export function TelaCentral({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">M3</div>
          <div><div className="font-semibold">MRV3D Solutions</div><div className="text-xs text-slate-500">{sub || "Gestão para impressão 3D"}</div></div>
        </div>
        {children}
      </div>
    </div>
  );
}
