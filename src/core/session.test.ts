import { describe, expect, test } from 'vitest'
import { MemoryStore } from '../store/memory'
import { DEFAULT_SESSION_ID } from '../store/store'
import {
  addRun,
  applyGrades,
  createSession,
  currentItem,
  extendSession,
  goTo,
  judge,
  judgmentsToQrels,
  move,
  progress,
  setContribute,
  skip,
  undo,
} from './session'
import type { Doc, NamedRun, SessionState } from './types'

const docs = new Map<string, Doc>(['a', 'b', 'c', 'd', 'e'].map((id) => [id, { text: `text ${id}` }]))
const queries = new Map([
  ['q1', 'first question'],
  ['q2', 'second question'],
])

function run(name: string, contribute: boolean, rows: Record<string, string[]>): NamedRun {
  return {
    name,
    contribute,
    entries: new Map(Object.entries(rows).map(([q, ds]) => [q, ds.map((docId, i) => ({ docId, score: 10 - i }))])),
  }
}

function make(): SessionState {
  return createSession({
    seed: 'seed',
    config: { depth: 3, dedupeByText: true },
    runs: [run('r1', true, { q1: ['a', 'b'], q2: ['c'] }), run('r2', false, { q1: ['d', 'e'] })],
    queries,
    docs,
  })
}

describe('session', () => {
  test('starts with every pool item pending and the cursor on the first', () => {
    const s = make()
    expect(progress(s)).toMatchObject({ total: 3, judged: 0, skipped: 0, pending: 3 })
    expect(currentItem(s)).toBeDefined()
    expect(s.cursor).toBe(0)
  })

  test('judging records the grade and moves to the next pending item', () => {
    let s = make()
    const first = s.order[0]
    s = judge(s, 3, 111)
    expect(s.judgments.get(first)).toEqual({ kind: 'grade', grade: 3, at: 111 })
    expect(s.cursor).toBe(1)
    expect(progress(s).judged).toBe(1)
  })

  test('grades 0 to 3 are all accepted', () => {
    let s = make()
    s = judge(s, 0)
    s = judge(s, 1)
    s = judge(s, 2)
    expect([...s.judgments.values()].map((e) => (e.kind === 'grade' ? e.grade : -1))).toEqual([0, 1, 2])
  })

  test('skip counts as done but is not a judgment; undo restores the previous state', () => {
    let s = make()
    const first = s.order[0]
    s = skip(s, 5)
    expect(progress(s)).toMatchObject({ judged: 0, skipped: 1, pending: 2 })
    expect(judgmentsToQrels(s).size).toBe(0)
    s = undo(s)
    expect(s.judgments.has(first)).toBe(false)
    expect(s.cursor).toBe(0)
  })

  test('undo of a re-judgment brings back the older grade', () => {
    let s = make()
    s = judge(s, 1)
    s = goTo(s, 0)
    s = judge(s, 3)
    expect((s.judgments.get(s.order[0]) as { grade: number }).grade).toBe(3)
    s = undo(s)
    expect((s.judgments.get(s.order[0]) as { grade: number }).grade).toBe(1)
  })

  test('undo with empty history changes nothing', () => {
    const s = make()
    expect(undo(s)).toBe(s)
  })

  test('move and goTo clamp to the list', () => {
    let s = make()
    s = move(s, -5)
    expect(s.cursor).toBe(0)
    s = move(s, 99)
    expect(s.cursor).toBe(2)
    s = goTo(s, 1)
    expect(s.cursor).toBe(1)
  })

  test('after the last pending item the cursor stays put', () => {
    let s = make()
    s = judge(judge(judge(s, 1), 1), 1)
    expect(progress(s).pending).toBe(0)
    expect(s.cursor).toBeLessThan(3)
  })

  test('per-query progress', () => {
    let s = make()
    s = judge(s, 2)
    const per = progress(s).perQuery
    expect(per.get('q1')!.total + per.get('q2')!.total).toBe(3)
    expect(per.get('q1')!.done + per.get('q2')!.done).toBe(1)
  })

  test('pool extension keeps judgments and adds only new items', () => {
    let s = make()
    s = judge(s, 3)
    const judgedId = [...s.judgments.keys()][0]
    s = extendSession(setContribute(s, 'r2', true))
    expect(s.items).toHaveLength(5)
    expect(s.judgments.has(judgedId)).toBe(true)
    expect(progress(s)).toMatchObject({ total: 5, judged: 1, pending: 4 })
  })

  test('the cursor stays on the same item after the order changes', () => {
    let s = make()
    s = goTo(s, 2)
    const id = s.order[2]
    s = extendSession(setContribute(s, 'r2', true))
    expect(s.order[s.cursor]).toBe(id)
  })

  test('applyGrades fills only pending items from a table', () => {
    let s = make()
    s = judge(s, 0)
    const table = new Map([['q1', new Map([['a', 3], ['b', 2]])], ['q2', new Map([['c', 1]])]])
    s = applyGrades(s, table)
    expect(progress(s).pending).toBe(0)
  })
})

describe('persistence', () => {
  test('save, then load into a fresh store object: same state, can continue', async () => {
    const store = new MemoryStore()
    let s = make()
    s = judge(s, 2, 1)
    s = skip(s, 2)
    await store.save(DEFAULT_SESSION_ID, s)

    const loaded = (await new MemoryStore().load(DEFAULT_SESSION_ID)) ?? (await store.load(DEFAULT_SESSION_ID))!
    expect(loaded).toEqual(s)
    expect(loaded).not.toBe(s)
    expect(progress(loaded)).toEqual(progress(s))
    const resumed = undo(judge(loaded, 3, 9))
    expect(resumed.judgments).toEqual(loaded.judgments)
  })

  test('load of a missing id is undefined, list and remove work', async () => {
    const store = new MemoryStore()
    expect(await store.load('nope')).toBeUndefined()
    await store.save('x', make())
    expect(await store.list()).toEqual(['x'])
    await store.remove('x')
    expect(await store.list()).toEqual([])
  })
})

describe('addRun', () => {
  test('adds an evaluate-only run, replaces one with the same name, and keeps docs', () => {
    let s = make()
    s = addRun(s, run('r3', false, { q1: ['e'] }), docs)
    expect(s.runs.map((r) => r.name)).toEqual(['r1', 'r2', 'r3'])
    expect(s.docs.has('e')).toBe(true)
    s = addRun(s, run('r3', true, { q1: ['a'] }))
    expect(s.runs).toHaveLength(3)
    expect(s.runs[2].contribute).toBe(true)
    expect(s.items).toHaveLength(3)
  })
})
