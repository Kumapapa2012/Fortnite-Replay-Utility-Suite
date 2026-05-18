import { createContext, useContext } from "react";

export type Lang = "ja" | "en";

export const SUPPORTED_LANGS: Lang[] = ["ja", "en"];
export const DEFAULT_LANG: Lang = "en";

export const LangContext = createContext<Lang>(DEFAULT_LANG);

export function useLang(): Lang {
  return useContext(LangContext);
}

export function parseLang(raw: string | undefined): Lang {
  return SUPPORTED_LANGS.includes(raw as Lang) ? (raw as Lang) : DEFAULT_LANG;
}
