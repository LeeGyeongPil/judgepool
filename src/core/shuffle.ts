// Seeded blind ordering. Each item's position key depends only on the seed
// and the item id, so extending the pool never reshuffles existing items.

import { fnv1a32 } from './textkey'
import type { BlindItem, PoolItem } from './types'

/** mulberry32: tiny deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function orderKey(seed: string, itemId: string): number {
  return mulberry32(fnv1a32(`${seed}\u0001${itemId}`))()
}

/**
 * Item ids in blind order: queries stay in `queryOrder`, items inside a query
 * are ordered by their seeded key.
 */
export function blindOrder(items: PoolItem[], queryOrder: string[], seed: string): string[] {
  const rank = new Map<string, number>()
  queryOrder.forEach((qid, i) => rank.set(qid, i))
  const unknown = queryOrder.length
  return items
    .map((item) => ({ id: item.id, q: rank.get(item.qid) ?? unknown, key: orderKey(seed, item.id) }))
    .sort((a, b) => a.q - b.q || a.key - b.key || (a.id < b.id ? -1 : 1))
    .map((x) => x.id)
}

/** The only view of an item the judging screen receives: no run, no rank. */
export function toBlindItem(item: PoolItem, queries: Map<string, string>): BlindItem {
  const blind: BlindItem = {
    id: item.id,
    qid: item.qid,
    queryText: queries.get(item.qid) ?? item.qid,
    text: item.text,
  }
  if (item.title !== undefined) blind.title = item.title
  return blind
}
