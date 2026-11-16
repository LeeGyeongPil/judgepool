import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { detectLang, LANG_STORAGE_KEY, loadStoredLang, messages, saveLang, translate } from './i18n'
import { CLI_MESSAGES, detectCliLang, t as cliT } from '../../bin/messages.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('screen messages', () => {
  test('en and ko have exactly the same keys', () => {
    expect(Object.keys(messages.ko).sort()).toEqual(Object.keys(messages.en).sort())
  })

  test('no value is empty', () => {
    for (const lang of ['en', 'ko'] as const) {
      for (const [key, value] of Object.entries(messages[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('')
      }
    }
  })

  test('placeholders match between languages', () => {
    for (const key of Object.keys(messages.en)) {
      expect(placeholders(messages.ko[key]), key).toEqual(placeholders(messages.en[key]))
    }
  })

  test('Korean values actually contain Korean for prose messages', () => {
    const prose = ['app.tagline', 'judge.help.grades', 'cmp.warn', 'runs.help']
    for (const key of prose) expect(messages.ko[key]).toMatch(/[가-힣]/)
  })

  test('every t("...") key used in the UI exists', () => {
    const files = ['../App.tsx', ...readdirSync(join(here, '../ui')).filter((f) => f.endsWith('.tsx')).map((f) => `../ui/${f}`)]
    const missing: string[] = []
    for (const file of files) {
      const source = readFileSync(join(here, file), 'utf8')
      for (const m of source.matchAll(/\bt\(\s*['"`]([\w.]+)['"`]/g)) {
        if (!(m[1] in messages.en)) missing.push(`${file}:${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('dynamic keys (tab., grade., kind., export.) are all present', () => {
    for (const k of ['tab.load', 'tab.judge', 'tab.compare', 'tab.export', 'grade.0', 'grade.1', 'grade.2', 'grade.3']) {
      expect(messages.en[k]).toBeDefined()
    }
    for (const kind of ['run', 'queries', 'corpus', 'qrels', 'backup', 'unknown']) expect(messages.en[`kind.${kind}`]).toBeDefined()
    for (const f of ['trec', 'beir', 'backup']) {
      expect(messages.en[`export.${f}`]).toBeDefined()
      expect(messages.en[`export.${f}.help`]).toBeDefined()
    }
  })

  test('every parse issue code used in the core has a message in both languages', () => {
    const codes = new Set<string>()
    for (const file of ['../core/parse.ts', '../core/export.ts', '../ui/ingest.ts', '../App.tsx']) {
      const source = readFileSync(join(here, file), 'utf8')
      for (const m of source.matchAll(/code: (?:'([\w.]+)'|[^'\n]*\? '([\w.]+)' : '([\w.]+)')/g)) {
        for (const c of m.slice(1)) if (c) codes.add(c)
      }
    }
    expect(codes.size).toBeGreaterThan(15)
    for (const c of codes) {
      expect(messages.en[`issue.${c}`], `en:${c}`).toBeDefined()
      expect(messages.ko[`issue.${c}`], `ko:${c}`).toBeDefined()
    }
  })

  test('translate fills placeholders and switches language', () => {
    expect(translate('en', 'pool.summary', { queries: 2, items: 5, pending: 1 })).toBe('2 queries, 5 items to judge, 1 still pending.')
    expect(translate('ko', 'pool.summary', { queries: 2, items: 5, pending: 1 })).toContain('질문 2개')
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
})

describe('language detection', () => {
  test('saved choice wins over the browser language', () => {
    expect(detectLang({ stored: 'en', languages: ['ko-KR'] })).toBe('en')
    expect(detectLang({ stored: 'ko', languages: ['en-US'] })).toBe('ko')
  })

  test('first run follows the browser: Korean -> ko, anything else -> en', () => {
    expect(detectLang({ languages: ['ko-KR', 'en'] })).toBe('ko')
    expect(detectLang({ languages: ['ko'] })).toBe('ko')
    expect(detectLang({ languages: ['en-US', 'ko'] })).toBe('en')
    expect(detectLang({ languages: ['fr-FR', 'ko'] })).toBe('ko')
    expect(detectLang({ languages: ['fr-FR'] })).toBe('en')
    expect(detectLang({})).toBe('en')
  })

  test('an invalid saved value is ignored', () => {
    expect(detectLang({ stored: 'xx', languages: ['ko'] })).toBe('ko')
  })

  test('?lang= in the address wins (used for screenshots)', () => {
    expect(detectLang({ search: '?lang=ko', stored: 'en', languages: ['en'] })).toBe('ko')
    expect(detectLang({ search: '?lang=zz', stored: 'ko' })).toBe('ko')
  })

  test('the choice is saved and survives re-detection', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    saveLang(storage, 'ko')
    expect(data.get(LANG_STORAGE_KEY)).toBe('ko')
    expect(detectLang({ stored: loadStoredLang(storage), languages: ['en-US'] })).toBe('ko')
  })

  test('a throwing storage never breaks the app', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadStoredLang(broken)).toBeNull()
    expect(() => saveLang(broken, 'ko')).not.toThrow()
  })
})

describe('CLI messages', () => {
  test('same keys in both languages, none empty', () => {
    expect(Object.keys(CLI_MESSAGES.ko).sort()).toEqual(Object.keys(CLI_MESSAGES.en).sort())
    for (const lang of ['en', 'ko'] as const) {
      for (const [key, value] of Object.entries(CLI_MESSAGES[lang])) expect((value as string).trim(), `${lang}:${key}`).not.toBe('')
    }
  })

  test('priority: --lang > JUDGEPOOL_LANG > LC_ALL > LC_MESSAGES > LANG', () => {
    expect(detectCliLang({ flag: 'ko', env: { JUDGEPOOL_LANG: 'en' } })).toBe('ko')
    expect(detectCliLang({ env: { JUDGEPOOL_LANG: 'ko', LANG: 'en_US.UTF-8' } })).toBe('ko')
    expect(detectCliLang({ env: { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' } })).toBe('ko')
    expect(detectCliLang({ env: { LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' } })).toBe('ko')
    expect(detectCliLang({ env: { LANG: 'ko_KR.UTF-8' } })).toBe('ko')
    expect(detectCliLang({ env: { LANG: 'fr_FR.UTF-8' } })).toBe('en')
    expect(detectCliLang({ env: {} })).toBe('en')
    expect(detectCliLang({ flag: 'en', env: { LANG: 'ko_KR.UTF-8' } })).toBe('en')
  })

  test('t fills placeholders', () => {
    expect(cliT('en', 'running', { url: 'http://x' })).toContain('http://x')
    expect(cliT('ko', 'running', { url: 'http://x' })).toContain('http://x')
  })
})
