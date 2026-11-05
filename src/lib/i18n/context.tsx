"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { translate, type Locale, type MessageKey } from "./messages";

const Ctx = createContext<Locale>("en");

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useLocale(): Locale {
  return useContext(Ctx);
}

/** Translation function bound to the active locale. */
export function useT() {
  const locale = useContext(Ctx);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  return useMemo(() => ({ t, locale }), [t, locale]);
}
