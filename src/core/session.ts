// Judging session: pure state transitions (no DOM, no storage).
// Every function returns a new state; the old one is never mutated.

import { buildPool, extendPool } from './pool'
import { blindOrder } from './shuffle'
import type {
  Doc,
  Grade,
  HistoryRecord,
  JudgmentEntry,
  NamedRun,
  PoolConfig,
  PoolItem,
  Qrels,
  SessionState,
} from './types'

export const MAX_HISTORY = 1000

export interface NewSessionInput {
  judge?: string
  seed?: string
  config: PoolConfig
  runs: NamedRun[]
  queries: Map<string, string>
  docs: Map<string, Doc>
  baseQrels?: Qrels
}

function deriveQueryOrder(queries: Map<string, string>, items: PoolItem[]): string[] {
  const inPool = new Set(items.map((i) => i.qid))
  const order = [...queries.keys()].filter((q) => inPool.has(q))
  for (const qid of inPool) if (!order.includes(qid)) order.push(qid)
  return order
}

/** Keep only the corpus docs that some run returns (bounds what we store). */
function referencedDocs(runs: NamedRun[], docs: Map<string, Doc>, into: Map<string, Doc> = new Map()): Map<string, Doc> {
  for (const run of runs) {
    for (const entries of run.entries.values()) {
      for (const entry of entries) {
        const doc = docs.get(entry.docId)
        if (doc) into.set(entry.docId, doc)
      }
    }
  }
  return into
}

export function createSession(input: NewSessionInput): SessionState {
  const seed = input.seed ?? 'judgepool'
  const kept = referencedDocs(input.runs, input.docs)
  const { items } = buildPool(input.runs, kept, input.config)
  const queryOrder = deriveQueryOrder(input.queries, items)
  return {
    version: 1,
    judge: input.judge ?? 'me',
    seed,
    config: { ...input.config },
    runs: input.runs,
    queries: input.queries,
    queryOrder,
    docs: kept,
    baseQrels: input.baseQrels ?? new Map(),
    items,
    order: blindOrder(items, queryOrder, seed),
    judgments: new Map(),
    history: [],
    cursor: 0,
  }
}

/** Re-pool after contributors or depth changed. Existing judgments are kept. */
export function extendSession(state: SessionState, config?: PoolConfig): SessionState {
  const nextConfig = config ?? state.config
  const { items } = extendPool(state.items, state.runs, state.docs, nextConfig)
  const queryOrder = deriveQueryOrder(state.queries, items)
  const currentId = state.order[state.cursor]
  const order = blindOrder(items, queryOrder, state.seed)
  const cursor = currentId === undefined ? 0 : Math.max(0, order.indexOf(currentId))
  return { ...state, config: { ...nextConfig }, items, queryOrder, order, cursor }
}

/**
 * Add a run (or replace the run with the same name). New runs start as
 * evaluate-only unless `contribute` is set; pass `docs` to supply passage text.
 */
export function addRun(state: SessionState, run: NamedRun, docs?: Map<string, Doc>): SessionState {
  const runs = state.runs.some((r) => r.name === run.name)
    ? state.runs.map((r) => (r.name === run.name ? run : r))
    : [...state.runs, run]
  const merged = new Map(state.docs)
  referencedDocs([run], docs ?? new Map(), merged)
  return { ...state, runs, docs: merged }
}

/** Merge corpus docs into the session (only docs some run returns are kept). */
export function mergeDocs(state: SessionState, docs: Map<string, Doc>): SessionState {
  const merged = new Map(state.docs)
  referencedDocs(state.runs, docs, merged)
  return { ...state, docs: merged }
}

export function setContribute(state: SessionState, runName: string, contribute: boolean): SessionState {
  return { ...state, runs: state.runs.map((r) => (r.name === runName ? { ...r, contribute } : r)) }
}

export function currentItemId(state: SessionState): string | undefined {
  return state.order[state.cursor]
}

export function currentItem(state: SessionState): PoolItem | undefined {
  const id = currentItemId(state)
  return id === undefined ? undefined : state.items.find((i) => i.id === id)
}

function nextPendingIndex(state: SessionState, from: number): number {
  const n = state.order.length
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n
    if (!state.judgments.has(state.order[idx])) return idx
  }
  return from
}

function record(state: SessionState, itemId: string): HistoryRecord[] {
  const rec: HistoryRecord = { itemId, prev: state.judgments.get(itemId), cursor: state.cursor }
  const history = [...state.history, rec]
  return history.length > MAX_HISTORY ? history.slice(history.length - MAX_HISTORY) : history
}

export function judge(state: SessionState, grade: Grade, at: number = Date.now()): SessionState {
  const id = currentItemId(state)
  if (id === undefined) return state
  const judgments = new Map(state.judgments)
  judgments.set(id, { kind: 'grade', grade, at })
  const next = { ...state, judgments, history: record(state, id) }
  return { ...next, cursor: nextPendingIndex(next, state.cursor) }
}

export function skip(state: SessionState, at: number = Date.now()): SessionState {
  const id = currentItemId(state)
  if (id === undefined) return state
  const judgments = new Map(state.judgments)
  judgments.set(id, { kind: 'skip', at })
  const next = { ...state, judgments, history: record(state, id) }
  return { ...next, cursor: nextPendingIndex(next, state.cursor) }
}

export function undo(state: SessionState): SessionState {
  const last = state.history[state.history.length - 1]
  if (!last) return state
  const judgments = new Map(state.judgments)
  if (last.prev) judgments.set(last.itemId, last.prev)
  else judgments.delete(last.itemId)
  return { ...state, judgments, history: state.history.slice(0, -1), cursor: last.cursor }
}

export function goTo(state: SessionState, index: number): SessionState {
  if (state.order.length === 0) return state
  const cursor = Math.min(Math.max(index, 0), state.order.length - 1)
  return { ...state, cursor }
}

export function move(state: SessionState, delta: number): SessionState {
  return goTo(state, state.cursor + delta)
}

export interface Progress {
  total: number
  judged: number
  skipped: number
  pending: number
  perQuery: Map<string, { total: number; done: number }>
}

export function progress(state: SessionState): Progress {
  let judged = 0
  let skipped = 0
  const perQuery = new Map<string, { total: number; done: number }>()
  for (const item of state.items) {
    const entry = state.judgments.get(item.id)
    const slot = perQuery.get(item.qid) ?? { total: 0, done: 0 }
    slot.total += 1
    if (entry?.kind === 'grade') {
      judged += 1
      slot.done += 1
    } else if (entry?.kind === 'skip') {
      skipped += 1
      slot.done += 1
    }
    perQuery.set(item.qid, slot)
  }
  const total = state.items.length
  return { total, judged, skipped, pending: total - judged - skipped, perQuery }
}

/**
 * Judgments as qrels. A text-merged item's grade is copied to every original
 * doc id; skipped and unjudged items are left out. New judgments override the
 * imported base qrels.
 */
export function judgmentsToQrels(state: SessionState, includeBase = true): Qrels {
  const qrels: Qrels = new Map()
  const put = (qid: string, docId: string, rel: number) => {
    let inner = qrels.get(qid)
    if (!inner) {
      inner = new Map()
      qrels.set(qid, inner)
    }
    inner.set(docId, rel)
  }
  if (includeBase) for (const [qid, docs] of state.baseQrels) for (const [d, rel] of docs) put(qid, d, rel)
  for (const item of state.items) {
    const entry = state.judgments.get(item.id)
    if (entry?.kind !== 'grade') continue
    for (const docId of item.docIds) put(item.qid, docId, entry.grade)
  }
  return qrels
}

/** Apply grades from an external table (query id, doc id -> grade) to pending items. */
export function applyGrades(
  state: SessionState,
  table: Map<string, Map<string, number>>,
  at: number = Date.now(),
): SessionState {
  const judgments = new Map(state.judgments)
  for (const item of state.items) {
    if (judgments.has(item.id)) continue
    const row = table.get(item.qid)
    if (!row) continue
    for (const docId of item.docIds) {
      const g = row.get(docId)
      if (g !== undefined && g >= 0 && g <= 3) {
        judgments.set(item.id, { kind: 'grade', grade: g as Grade, at })
        break
      }
    }
  }
  return { ...state, judgments }
}

export type { JudgmentEntry }
