import { describe, expect, test } from 'vitest'
import { blindOrder, mulberry32, orderKey, toBlindItem } from './shuffle'
import type { PoolItem } from './types'

const items: PoolItem[] = Array.from({ length: 30 }, (_, i) => ({
  id: `${i % 2 === 0 ? 'q1' : 'q2'}\td:doc${i}`,
  qid: i % 2 === 0 ? 'q1' : 'q2',
  docIds: [`doc${i}`],
  text: `passage ${i}`,
}))

describe('blind order', () => {
  test('the same seed gives the same order', () => {
    expect(blindOrder(items, ['q1', 'q2'], 's1')).toEqual(blindOrder(items, ['q1', 'q2'], 's1'))
  })

  test('a different seed gives a different order', () => {
    expect(blindOrder(items, ['q1', 'q2'], 's1')).not.toEqual(blindOrder(items, ['q1', 'q2'], 's2'))
  })

  test('contains every item once and keeps queries together in query order', () => {
    const order = blindOrder(items, ['q2', 'q1'], 's1')
    expect(new Set(order).size).toBe(items.length)
    const qids = order.map((id) => id.split('\t')[0])
    expect(qids.slice(0, 15).every((q) => q === 'q2')).toBe(true)
    expect(qids.slice(15).every((q) => q === 'q1')).toBe(true)
  })

  test('adding items keeps the relative order of the existing ones', () => {
    const before = blindOrder(items.slice(0, 20), ['q1', 'q2'], 's1')
    const after = blindOrder(items, ['q1', 'q2'], 's1').filter((id) => before.includes(id))
    expect(after).toEqual(before)
  })

  test('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
    expect(orderKey('s', 'x')).toBe(orderKey('s', 'x'))
  })
})

describe('blind item', () => {
  test('exposes only id, query, title and text: no run name, no rank, no doc ids', () => {
    const withTitle: PoolItem = { ...items[0], title: 'T' }
    const blind = toBlindItem(withTitle, new Map([['q1', 'the question']]))
    expect(Object.keys(blind).sort()).toEqual(['id', 'qid', 'queryText', 'text', 'title'])
    expect(blind.queryText).toBe('the question')
    const json = JSON.stringify(blind)
    expect(json).not.toMatch(/rank|run|docIds|score/i)
  })

  test('falls back to the query id when the query text is unknown', () => {
    expect(toBlindItem(items[0], new Map()).queryText).toBe('q1')
  })
})
