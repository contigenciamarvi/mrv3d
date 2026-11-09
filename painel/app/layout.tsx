import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "MRV 3D Solutions · Gestão de impressão 3D",
  robots: { index: false, follow: false },
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icone.svg", type: "image/svg+xml" }], apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
        <Script src="/tema.js" strategy="beforeInteractive" />
      </head>
      <body>{children}</body>
    </html>
  );
}
