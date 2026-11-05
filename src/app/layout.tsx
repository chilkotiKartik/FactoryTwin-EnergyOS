import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { Toaster } from "sonner";
import { getLocale } from "@/server/locale";
import { I18nProvider } from "@/lib/i18n/context";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const deva = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "500", "600", "700"], variable: "--font-deva", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FactoryTwin EnergyOS", template: "%s · FactoryTwin EnergyOS" },
  description: "Production-aware energy optimisation for induction-furnace foundries: heat-level energy, explainable anomalies, feasible schedules, human approval and savings verification.",
};

export const viewport: Viewport = { themeColor: "#0f1727", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale === "en" ? "en-IN" : locale} className={`${sans.variable} ${mono.variable} ${deva.variable}`}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-plex-sans)" } }} />
      </body>
    </html>
  );
}
