import { describe, expect, test } from 'vitest'
import { buildPool, extendPool } from './pool'
import { normalizeText, textKey } from './textkey'
import type { Doc, NamedRun, PoolConfig } from './types'

function run(name: string, contribute: boolean, rows: Record<string, string[]>): NamedRun {
  const entries = new Map(
    Object.entries(rows).map(([qid, docs]) => [qid, docs.map((docId, i) => ({ docId, score: 100 - i }))]),
  )
  return { name, contribute, entries }
}

const docs = new Map<string, Doc>([
  ['a', { text: 'Reset your password' }],
  ['a2', { text: '  reset   YOUR password ' }],
  ['b', { text: 'Share a notebook' }],
  ['c', { text: 'Export to PDF' }],
  ['d', { text: 'Dark mode' }],
])
const cfg: PoolConfig = { depth: 2, dedupeByText: false }

describe('buildPool', () => {
  test('takes the depth-k union of contributing runs only', () => {
    const runs = [run('r1', true, { q1: ['a', 'b', 'c'] }), run('r2', true, { q1: ['d', 'b', 'a'] }), run('r3', false, { q1: ['c'] })]
    const { items } = buildPool(runs, docs, cfg)
    expect(items.map((i) => i.docIds[0]).sort()).toEqual(['a', 'b', 'd'])
  })

  test('removes duplicates by doc id within a query but not across queries', () => {
    const runs = [run('r1', true, { q1: ['a', 'b'], q2: ['a'] }), run('r2', true, { q1: ['a'] })]
    const { items } = buildPool(runs, docs, cfg)
    expect(items.filter((i) => i.qid === 'q1')).toHaveLength(2)
    expect(items.filter((i) => i.qid === 'q2')).toHaveLength(1)
  })

  test('groups identical normalised text under one item and keeps both doc ids', () => {
    const runs = [run('r1', true, { q1: ['a'] }), run('r2', true, { q1: ['a2'] })]
    const grouped = buildPool(runs, docs, { depth: 2, dedupeByText: true }).items
    expect(grouped).toHaveLength(1)
    expect(grouped[0].docIds).toEqual(['a', 'a2'])
    const separate = buildPool(runs, docs, { depth: 2, dedupeByText: false }).items
    expect(separate).toHaveLength(2)
  })

  test('text from the run is used when the corpus lacks the doc', () => {
    const r: NamedRun = { name: 'r', contribute: true, entries: new Map([['q1', [{ docId: 'zz', score: 1, text: 'inline' }]]]) }
    expect(buildPool([r], new Map(), cfg).items[0].text).toBe('inline')
  })

  test('items without any text are never merged', () => {
    const runs = [run('r1', true, { q1: ['x', 'y'] })]
    expect(buildPool(runs, new Map(), { depth: 2, dedupeByText: true }).items).toHaveLength(2)
  })
})

describe('extendPool', () => {
  test('keeps existing items and reports only new ones', () => {
    const r1 = run('r1', true, { q1: ['a', 'b'] })
    const r2 = run('r2', false, { q1: ['c', 'b', 'd'] })
    const first = buildPool([r1, r2], docs, cfg)
    const second = extendPool(first.items, [r1, { ...r2, contribute: true }], docs, cfg)
    expect(second.items.slice(0, first.items.length).map((i) => i.id)).toEqual(first.items.map((i) => i.id))
    expect(second.added.map((i) => i.docIds[0]).sort()).toEqual(['c'])
    expect(second.items).toHaveLength(first.items.length + 1)
  })

  test('a deeper pool adds only the extra documents', () => {
    const r = run('r', true, { q1: ['a', 'b', 'c', 'd'] })
    const shallow = buildPool([r], docs, { depth: 2, dedupeByText: false })
    const deep = extendPool(shallow.items, [r], docs, { depth: 4, dedupeByText: false })
    expect(deep.added.map((i) => i.docIds[0])).toEqual(['c', 'd'])
  })

  test('a new doc that matches an existing text group joins it instead of adding an item', () => {
    const r1 = run('r1', true, { q1: ['a'] })
    const r2 = run('r2', true, { q1: ['a2'] })
    const first = buildPool([r1, { ...r2, contribute: false }], docs, { depth: 2, dedupeByText: true })
    const next = extendPool(first.items, [r1, r2], docs, { depth: 2, dedupeByText: true })
    expect(next.added).toEqual([])
    expect(next.items[0].docIds).toEqual(['a', 'a2'])
    expect(first.items[0].docIds).toEqual(['a'])
  })

  test('re-running with no change adds nothing', () => {
    const r = run('r', true, { q1: ['a', 'b'] })
    const first = buildPool([r], docs, cfg)
    expect(extendPool(first.items, [r], docs, cfg).added).toEqual([])
  })
})

describe('text keys', () => {
  test('normalisation: NFKC, case and whitespace', () => {
    expect(normalizeText('  ＡＢＣ\n def ')).toBe('abc def')
    expect(textKey('Hello   World')).toBe(textKey('hello world'))
    expect(textKey('hello world')).not.toBe(textKey('hello worlds'))
    expect(textKey('x')).toMatch(/^[0-9a-f]{16}$/)
  })
})
