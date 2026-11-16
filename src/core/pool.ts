// Pooling: take each contributing run's top-k per query, union them, drop
// duplicates (by doc id and, optionally, by identical text).

import { textKey } from './textkey'
import type { Doc, NamedRun, PoolConfig, PoolItem } from './types'

export const DEFAULT_POOL_CONFIG: PoolConfig = { depth: 10, dedupeByText: true }

/** Text shown for a doc: corpus first, then the text carried by the run. */
function resolveDoc(docId: string, runText: string | undefined, docs: Map<string, Doc>): { title?: string; text: string } {
  const doc = docs.get(docId)
  if (doc) return doc.title ? { title: doc.title, text: doc.text } : { text: doc.text }
  return { text: runText ?? '' }
}

export interface PoolResult {
  items: PoolItem[]
  /** Items that did not exist in `existing` (all of them for a fresh pool). */
  added: PoolItem[]
}

/**
 * Build a pool, or extend an existing one. Items already present keep their
 * id (so judgments stay attached); only unseen items are reported as added.
 * A doc that joins an existing text group is appended to that item's docIds.
 */
export function extendPool(
  existing: PoolItem[],
  runs: NamedRun[],
  docs: Map<string, Doc>,
  config: PoolConfig,
): PoolResult {
  const byId = new Map<string, PoolItem>()
  const items: PoolItem[] = []
  for (const item of existing) {
    const copy: PoolItem = { ...item, docIds: [...item.docIds] }
    byId.set(copy.id, copy)
    items.push(copy)
  }
  // doc id -> item, per query, so one doc id never creates two items.
  const byDoc = new Map<string, PoolItem>()
  for (const item of items) for (const docId of item.docIds) byDoc.set(`${item.qid}\t${docId}`, item)
  const added: PoolItem[] = []

  for (const run of runs) {
    if (!run.contribute) continue
    for (const [qid, entries] of run.entries) {
      for (const entry of entries.slice(0, config.depth)) {
        const docKey = `${qid}\t${entry.docId}`
        if (byDoc.has(docKey)) continue
        const { title, text } = resolveDoc(entry.docId, entry.text, docs)
        const groupable = config.dedupeByText && text.trim() !== ''
        const itemId = groupable ? `${qid}\tt:${textKey(`${title ?? ''}\n${text}`)}` : `${qid}\td:${entry.docId}`
        const found = byId.get(itemId)
        if (found) {
          found.docIds.push(entry.docId)
          byDoc.set(docKey, found)
          continue
        }
        const item: PoolItem = { id: itemId, qid, docIds: [entry.docId], text }
        if (title !== undefined) item.title = title
        byId.set(itemId, item)
        byDoc.set(docKey, item)
        items.push(item)
        added.push(item)
      }
    }
  }
  return { items, added }
}

export function buildPool(runs: NamedRun[], docs: Map<string, Doc>, config: PoolConfig): PoolResult {
  return extendPool([], runs, docs, config)
}
