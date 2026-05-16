import { useNavigate } from "react-router-dom";
import { useLang } from "../contexts/LangContext";

export function useLangNavigate() {
  const navigate = useNavigate();
  const lang = useLang();
  return (path: string) => navigate(`/${lang}${path}`);
}
