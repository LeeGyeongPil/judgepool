import { describe, expect, test } from 'vitest'
import { compareRuns } from './compare'
import { exportBeirTsv, exportTrecQrels, readBackup, writeBackup } from './export'
import { parseQrels } from './parse'
import { applyGrades, createSession, judge, skip } from './session'
import type { Doc, NamedRun, SessionState } from './types'

const docs = new Map<string, Doc>([
  ['a', { text: 'Reset your password' }],
  ['a2', { text: 'reset  your PASSWORD' }],
  ['b', { text: 'Share a notebook' }],
  ['c', { text: 'Export to PDF' }],
])

function run(name: string, contribute: boolean, rows: Record<string, string[]>): NamedRun {
  return {
    name,
    contribute,
    entries: new Map(Object.entries(rows).map(([q, ds]) => [q, ds.map((docId, i) => ({ docId, score: 10 - i }))])),
  }
}

function judged(): SessionState {
  let s = createSession({
    seed: 'x',
    judge: 'tester',
    config: { depth: 5, dedupeByText: true },
    runs: [run('bm25', true, { q1: ['a', 'b'], q2: ['c'] }), run('dense', true, { q1: ['a2', 'c'] })],
    queries: new Map([['q1', 'one'], ['q2', 'two']]),
    docs,
    baseQrels: new Map([['q9', new Map([['old', 1]])]]),
  })
  s = applyGrades(s, new Map([['q1', new Map([['a', 3], ['b', 1], ['c', 2]])], ['q2', new Map([['c', 0]])]]), 7)
  return s
}

describe('qrels export', () => {
  test('TREC format: qid 0 docid rel, text groups copied to every doc id', () => {
    const text = exportTrecQrels(judged())
    expect(text.split('\n')).toEqual(['q1 0 a 3', 'q1 0 a2 3', 'q1 0 b 1', 'q1 0 c 2', 'q2 0 c 0', 'q9 0 old 1', ''])
  })

  test('BEIR TSV has the header and tab separation', () => {
    const lines = exportBeirTsv(judged()).split('\n')
    expect(lines[0]).toBe('query-id\tcorpus-id\tscore')
    expect(lines[1]).toBe('q1\ta\t3')
  })

  test('skipped and unjudged items are not exported', () => {
    let s = createSession({
      config: { depth: 5, dedupeByText: false },
      runs: [run('r', true, { q1: ['a', 'b', 'c'] })],
      queries: new Map([['q1', 'one']]),
      docs,
    })
    s = skip(s, 1)
    s = judge(s, 2, 2)
    const lines = exportTrecQrels(s).trim().split('\n')
    expect(lines).toHaveLength(1)
  })

  test('an empty session exports an empty TREC file and a header-only TSV', () => {
    const s = createSession({ config: { depth: 1, dedupeByText: true }, runs: [], queries: new Map(), docs })
    expect(exportTrecQrels(s)).toBe('')
    expect(exportBeirTsv(s)).toBe('query-id\tcorpus-id\tscore\n')
  })

  test('both formats read back to the same qrels', async () => {
    const s = judged()
    const trec = await parseQrels(exportTrecQrels(s))
    const beir = await parseQrels(exportBeirTsv(s))
    expect(beir.format).toBe('beir-qrels')
    expect(trec.qrels).toEqual(beir.qrels)
  })

  test('re-evaluating exported qrels gives the same table as the app', async () => {
    const s = judged()
    const direct = compareRuns(s.runs, (await parseQrels(exportTrecQrels(s))).qrels, { k: 2 })
    const viaBeir = compareRuns(s.runs, (await parseQrels(exportBeirTsv(s))).qrels, { k: 2 })
    expect(direct).toEqual(viaBeir)
    expect(direct.rows.map((r) => r.name)).toEqual(['bm25', 'dense'])
  })
})

describe('JSONL backup', () => {
  test('round trip gives an identical session', async () => {
    let s = judged()
    s = judge(s, 1, 99)
    const text = writeBackup(s)
    expect(text.endsWith('\n')).toBe(true)
    const back = await readBackup(text)
    expect(back.issues).toEqual([])
    expect(back.state).toEqual(s)
  })

  test('the backup is one JSON object per line and starts with a judgepool meta line', () => {
    const lines = writeBackup(judged()).trim().split('\n')
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
    expect(JSON.parse(lines[0])).toMatchObject({ t: 'meta', judgepool: 1, judge: 'tester', seed: 'x' })
  })

  test('a file that is not a backup is reported, not thrown', async () => {
    const r = await readBackup('{"hello":1}\nnot json\n')
    expect(r.state).toBeUndefined()
    expect(r.issues.length).toBeGreaterThan(0)
  })
})
