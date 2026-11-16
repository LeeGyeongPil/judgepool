// The bundled synthetic example must reproduce the pooling-bias lesson with
// real computation, and agree with ir_measures (ref.json).

import { describe, expect, test } from 'vitest'
import { compareRuns } from './compare'
import { exportTrecQrels } from './export'
import { exampleFile, fixture, refCases } from './__fixtures__/load'
import { parseCorpus, parseQueries, parseRun } from './parse'
import { applyGrades, createSession, extendSession, judgmentsToQrels, progress, setContribute } from './session'
import type { SessionState } from './types'

async function loadExample(): Promise<{ state: SessionState; docs: Awaited<ReturnType<typeof parseCorpus>>['docs']; grades: Map<string, Map<string, number>> }> {
  const queries = (await parseQueries(exampleFile('queries.jsonl'))).queries
  const docs = (await parseCorpus(exampleFile('corpus.jsonl'))).docs
  const runs = []
  for (const name of ['bm25', 'dense', 'hybrid']) {
    const parsed = await parseRun(exampleFile(`${name}.run`))
    expect(parsed.issues).toEqual([])
    runs.push({ name, contribute: name === 'bm25', entries: parsed.entries })
  }
  const grades = new Map<string, Map<string, number>>()
  for (const line of exampleFile('judgments.jsonl').trim().split('\n')) {
    const j = JSON.parse(line) as { query_id: string; doc_id: string; grade: number }
    if (!grades.has(j.query_id)) grades.set(j.query_id, new Map())
    grades.get(j.query_id)!.set(j.doc_id, j.grade)
  }
  const state = createSession({ config: { depth: 10, dedupeByText: true }, runs, queries, docs })
  return { state, docs, grades }
}

function row(state: SessionState, name: string) {
  const table = compareRuns(state.runs, judgmentsToQrels(state), { k: 10, poolDepth: 10 })
  return table.rows.find((r) => r.name === name)!
}

const ref = (name: string) => refCases().find((c) => c.name === name)!

describe('pooling bias example', () => {
  test('bm25-only pool: bm25 beats dense and dense is flagged', async () => {
    const { state, grades } = await loadExample()
    const biased = applyGrades(state, grades)
    const bm25 = row(biased, 'bm25')
    const dense = row(biased, 'dense')
    expect(bm25.mean.ndcg).toBeGreaterThan(dense.mean.ndcg)
    expect(dense.mean.judged).toBeLessThan(0.9)
    expect(dense.biasWarning).toBe(true)
    expect(bm25.biasWarning).toBe(false)
  })

  test('all three runs pooled: dense beats bm25 and nobody is flagged', async () => {
    const { state, grades } = await loadExample()
    let s = applyGrades(state, grades)
    s = setContribute(setContribute(s, 'dense', true), 'hybrid', true)
    s = extendSession(s)
    const added = progress(s).pending
    expect(added).toBeGreaterThan(0)
    s = applyGrades(s, grades)
    expect(progress(s).pending).toBe(0)
    expect(row(s, 'dense').mean.ndcg).toBeGreaterThan(row(s, 'bm25').mean.ndcg)
    for (const name of ['bm25', 'dense', 'hybrid']) {
      expect(row(s, name).biasWarning).toBe(false)
      expect(row(s, name).mean.judged).toBe(1)
    }
  })

  test('the ranking flips between the two pools', async () => {
    const { state, grades } = await loadExample()
    const biased = applyGrades(state, grades)
    const order = (s: SessionState) =>
      ['bm25', 'dense'].sort((a, b) => row(s, b).mean.ndcg - row(s, a).mean.ndcg)
    let full = setContribute(setContribute(biased, 'dense', true), 'hybrid', true)
    full = applyGrades(extendSession(full), grades)
    expect(order(biased)).toEqual(['bm25', 'dense'])
    expect(order(full)).toEqual(['dense', 'bm25'])
  })

  test('values equal the ir_measures reference for both pools', async () => {
    const { state, grades } = await loadExample()
    const biased = applyGrades(state, grades)
    let full = setContribute(setContribute(biased, 'dense', true), 'hybrid', true)
    full = applyGrades(extendSession(full), grades)
    for (const [scenario, s] of [['biased', biased], ['full', full]] as const) {
      for (const name of ['bm25', 'dense', 'hybrid']) {
        const expected = ref(`example-${scenario}-${name}`).common
        const m = row(s, name).mean
        expect(Math.abs(m.ndcg - expected.ndcg)).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(m.recall - expected.recall)).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(m.precision - expected.precision)).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(m.rr - expected.rr)).toBeLessThanOrEqual(1e-6)
        expect(Math.abs(m.judged - expected.judged)).toBeLessThanOrEqual(1e-6)
      }
    }
  })

  test('exported qrels equal the files the reference script used', async () => {
    const { state, grades } = await loadExample()
    const biased = applyGrades(state, grades)
    let full = setContribute(setContribute(biased, 'dense', true), 'hybrid', true)
    full = applyGrades(extendSession(full), grades)
    const sortLines = (t: string) => t.trim().split('\n').sort()
    expect(sortLines(exportTrecQrels(biased))).toEqual(sortLines(fixture('example_biased_qrels.txt')))
    expect(sortLines(exportTrecQrels(full))).toEqual(sortLines(fixture('example_full_qrels.txt')))
  })

  test('the example demonstrates text grouping and a score tie', async () => {
    const { state } = await loadExample()
    const all = setContribute(setContribute(state, 'dense', true), 'hybrid', true)
    const pooled = extendSession(all)
    expect(pooled.items.some((i) => i.docIds.length > 1)).toBe(true)
    const bm25q1 = state.runs[0].entries.get('q1')!
    expect(bm25q1[0].score).toBe(bm25q1[1].score)
  })
})
