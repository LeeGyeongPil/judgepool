// Screen language: English or Korean.
// Order of choice: ?lang= in the address > saved choice > browser languages > English.
// All wording lives in en.json / ko.json (same keys in both).

import en from './en.json'
import ko from './ko.json'

export type Lang = 'en' | 'ko'
export const LANGS: Lang[] = ['en', 'ko']
export const LANG_STORAGE_KEY = 'judgepool.lang'

export type MessageKey = keyof typeof en
export const messages: Record<Lang, Record<string, string>> = { en, ko }

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ko'
}

export interface LangEnvironment {
  /** Address query string, for example "?lang=ko" (used for screenshots). */
  search?: string
  /** Value saved by the language menu. */
  stored?: string | null
  /** navigator.languages */
  languages?: readonly string[]
}

/**
 * Pick the screen language. The first browser language that is Korean or
 * English decides (so ["en-US", "ko"] is English); anything else is English.
 */
export function detectLang(env: LangEnvironment): Lang {
  const fromQuery = new URLSearchParams(env.search ?? '').get('lang')
  if (isLang(fromQuery)) return fromQuery
  if (isLang(env.stored)) return env.stored
  for (const tag of env.languages ?? []) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'ko') return 'ko'
    if (base === 'en') return 'en'
  }
  return 'en'
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadStoredLang(storage: KeyValueStorage | undefined): string | null {
  try {
    return storage?.getItem(LANG_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function saveLang(storage: KeyValueStorage | undefined, lang: Lang): void {
  try {
    storage?.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // private mode: the choice just will not persist
  }
}

/** Look a message up and fill {name} placeholders. A missing key returns the key. */
export function translate(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const template = messages[lang][key] ?? messages.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
