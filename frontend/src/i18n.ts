import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import jaCommon from "./locales/ja/common.json";
import jaPages from "./locales/ja/pages.json";
import enCommon from "./locales/en/common.json";
import enPages from "./locales/en/pages.json";

i18n.use(initReactI18next).init({
  lng: "ja",
  fallbackLng: "ja",
  ns: ["common", "pages"],
  defaultNS: "common",
  resources: {
    ja: { common: jaCommon, pages: jaPages },
    en: { common: enCommon, pages: enPages },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
