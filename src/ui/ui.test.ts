// Server-side render smoke tests: every panel renders in both languages
// without throwing, and the judging screen never shows the system names.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { parseCorpus, parseQueries, parseRun } from '../core/parse'
import { applyGrades, createSession } from '../core/session'
import type { SessionState } from '../core/types'
import { exampleFile } from '../core/__fixtures__/load'
import { LangContext } from '../i18n/context'
import { translate, type Lang } from '../i18n/i18n'
import { ExportPanel } from './ExportPanel'
import { JudgeView } from './JudgeView'
import { LoadPanel } from './LoadPanel'
import { ResultsTable } from './ResultsTable'

async function example(): Promise<SessionState> {
  const runs = []
  for (const name of ['bm25', 'dense', 'hybrid']) {
    runs.push({ name, contribute: name === 'bm25', entries: (await parseRun(exampleFile(`${name}.run`))).entries })
  }
  return createSession({
    config: { depth: 10, dedupeByText: true },
    runs,
    queries: (await parseQueries(exampleFile('queries.jsonl'))).queries,
    docs: (await parseCorpus(exampleFile('corpus.jsonl'))).docs,
  })
}

function render(lang: Lang, element: ReturnType<typeof createElement>): string {
  const value = { lang, setLang: () => undefined, t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars) }
  return renderToString(createElement(LangContext.Provider, { value }, element))
}

const noop = () => undefined

describe('panels render in both languages', () => {
  test('judge view: question and passage shown, no system name, no rank', async () => {
    const session = await example()
    for (const lang of ['en', 'ko'] as const) {
      const html = render(lang, createElement(JudgeView, { session, onChange: noop }))
      expect(html).toContain(translate(lang, 'judge.query'))
      expect(html).toContain(translate(lang, 'grade.3'))
      expect(html).not.toMatch(/bm25|dense|hybrid/)
      expect(html).not.toMatch(/rank/i)
    }
  })

  test('compare table shows the bias warning after judging the bm25 pool', async () => {
    const examples = new Map<string, Map<string, number>>()
    for (const line of exampleFile('judgments.jsonl').trim().split('\n')) {
      const j = JSON.parse(line) as { query_id: string; doc_id: string; grade: number }
      if (!examples.has(j.query_id)) examples.set(j.query_id, new Map())
      examples.get(j.query_id)!.set(j.doc_id, j.grade)
    }
    const session = applyGrades(await example(), examples)
    const en = render('en', createElement(ResultsTable, { session }))
    expect(en).toContain('judged@')
    expect(en).toContain('Pooling bias warning')
    const ko = render('ko', createElement(ResultsTable, { session }))
    expect(ko).toContain('풀링 편향 경고')
  })

  test('export panel previews TREC qrels', async () => {
    const session = applyGrades(await example(), new Map([['q1', new Map([['rec-a', 3]])]]))
    expect(render('en', createElement(ExportPanel, { session }))).toContain('q1 0 rec-a 3')
  })

  test('load panel renders the drop zone and example button', async () => {
    const session = await example()
    const props = {
      busy: false,
      notes: [],
      runs: session.runs,
      config: session.config,
      seed: 's',
      judgeName: 'me',
      hasSession: true,
      canFillExample: true,
      queryCount: 6,
      poolSize: session.items.length,
      pending: session.items.length,
      onFiles: noop,
      onExample: noop,
      onToggle: noop,
      onApplyConfig: noop,
      onSeed: noop,
      onJudgeName: noop,
      onBuild: noop,
      onFillExample: noop,
      onReset: noop,
    }
    expect(render('ko', createElement(LoadPanel, props))).toContain('예제 불러오기')
    expect(render('en', createElement(LoadPanel, props))).toContain('Load example')
  })
})
