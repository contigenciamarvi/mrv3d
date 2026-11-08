import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "MRV3D · Gestão de impressão 3D",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
      </head>
      <body>{children}</body>
    </html>
  );
}
