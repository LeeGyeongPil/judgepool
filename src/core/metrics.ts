// Ranking metrics that follow trec_eval / ir_measures conventions:
//  - runs are re-sorted by score (desc), ties by doc id (desc); rank is ignored
//  - nDCG uses the grade as gain and 1/log2(rank+1) discount; ideal list comes from qrels
//  - recall/precision/RR binarise at `minRel`; precision divides by k
//  - Judged@k = share of the (up to k) retrieved docs that have any judgment;
//    the divisor is the number retrieved when a run is shorter than k

import type { Qrels, RunEntries } from './types'

export interface QueryMetrics {
  ndcg: number
  recall: number
  precision: number
  rr: number
  judged: number
}

export const METRIC_KEYS = ['ndcg', 'recall', 'precision', 'rr', 'judged'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export interface MetricOptions {
  k: number
  /** Relevance threshold for recall, precision and RR (1 or 2). Default 1. */
  minRel?: number
}

export function queryMetrics(ranked: string[], judgments: Map<string, number>, options: MetricOptions): QueryMetrics {
  const { k } = options
  const minRel = options.minRel ?? 1
  const top = ranked.slice(0, k)

  let dcg = 0
  top.forEach((docId, i) => {
    const gain = Math.max(judgments.get(docId) ?? 0, 0)
    dcg += gain / Math.log2(i + 2)
  })
  const ideal = [...judgments.values()]
    .filter((v) => v > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
  let idcg = 0
  ideal.forEach((gain, i) => {
    idcg += gain / Math.log2(i + 2)
  })

  let numRel = 0
  for (const v of judgments.values()) if (v >= minRel) numRel += 1
  const hits = top.filter((d) => (judgments.get(d) ?? 0) >= minRel).length
  const first = ranked.findIndex((d) => (judgments.get(d) ?? 0) >= minRel)
  const judgedInTop = top.filter((d) => judgments.has(d)).length

  return {
    ndcg: idcg > 0 ? dcg / idcg : 0,
    recall: numRel > 0 ? hits / numRel : 0,
    precision: k > 0 ? hits / k : 0,
    rr: first < 0 ? 0 : 1 / (first + 1),
    judged: top.length > 0 ? judgedInTop / top.length : 0,
  }
}

/**
 * 'trec'   - trec_eval default: only queries present in both run and qrels.
 * 'common' - trec_eval -c: every query in qrels; a query the run lacks scores 0.
 */
export type Averaging = 'trec' | 'common'

export interface RunEvaluation {
  perQuery: Map<string, QueryMetrics>
  mean: QueryMetrics
  /** Number of queries averaged. */
  queries: number
  /** Queries in qrels that this run has no results for (scored 0 in 'common'). */
  missing: number
}

const ZERO: QueryMetrics = { ndcg: 0, recall: 0, precision: 0, rr: 0, judged: 0 }

export function evaluateRun(
  run: RunEntries,
  qrels: Qrels,
  options: MetricOptions,
  averaging: Averaging = 'common',
): RunEvaluation {
  const perQuery = new Map<string, QueryMetrics>()
  let missing = 0
  for (const [qid, judgments] of qrels) {
    const entries = run.get(qid)
    if (!entries) {
      missing += 1
      if (averaging === 'common') perQuery.set(qid, { ...ZERO })
      continue
    }
    perQuery.set(
      qid,
      queryMetrics(
        entries.map((e) => e.docId),
        judgments,
        options,
      ),
    )
  }
  const mean = { ...ZERO }
  for (const m of perQuery.values()) for (const key of METRIC_KEYS) mean[key] += m[key]
  const n = perQuery.size
  if (n > 0) for (const key of METRIC_KEYS) mean[key] /= n
  return { perQuery, mean, queries: n, missing }
}
