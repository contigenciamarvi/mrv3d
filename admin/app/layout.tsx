import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Admin · MRV3D Solutions",
  robots: { index: false, follow: false },
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
