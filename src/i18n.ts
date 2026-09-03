import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

type Dict = Record<string, string>;
const dictionaries: Record<string, Dict> = { en, "zh-CN": zhCN };

let activeLocale: string = localStorage.getItem("language") ?? "en";
if (!dictionaries[activeLocale]) activeLocale = "en";

export function setLocale(l: string) {
  activeLocale = dictionaries[l] ? l : "zh-CN";
  localStorage.setItem("language", activeLocale);
}

export function getLocale(): string {
  return activeLocale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[activeLocale] ?? dictionaries.en;
  let s = dict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}
