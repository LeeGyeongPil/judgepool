import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { detectLang, loadStoredLang, saveLang, translate, type Lang } from './i18n'

export interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export const LangContext = createContext<LangContextValue | undefined>(undefined)

function initialLang(): Lang {
  return detectLang({
    search: window.location.search,
    stored: loadStoredLang(window.localStorage),
    languages: navigator.languages,
  })
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    saveLang(window.localStorage, next)
    document.documentElement.lang = next
  }, [])
  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )
  document.documentElement.lang = lang
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const value = useContext(LangContext)
  if (!value) throw new Error('useLang must be used inside <LangProvider>')
  return value
}
