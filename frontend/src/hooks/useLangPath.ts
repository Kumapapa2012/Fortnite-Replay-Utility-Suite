import { useLang } from "../contexts/LangContext";

export function useLangPath() {
  const lang = useLang();
  return (path: string) => `/${lang}${path}`;
}
