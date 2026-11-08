import type { NextConfig } from "next";

// Exportação estática: o painel roda 100% no navegador e é servido pelo Nginx da VPS.
// A segurança fica no banco (RLS + funções que conferem o perfil).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
