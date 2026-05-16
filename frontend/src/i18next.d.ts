import type jaCommon from "./locales/ja/common.json";
import type jaPages from "./locales/ja/pages.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof jaCommon;
      pages: typeof jaPages;
    };
  }
}
