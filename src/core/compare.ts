// System comparison table with pooling-bias warnings.

import { evaluateRun, type Averaging, type QueryMetrics } from './metrics'
import type { NamedRun, Qrels } from './types'

export const DEFAULT_JUDGED_THRESHOLD = 0.9

export interface CompareOptions {
  k: number
  minRel?: number
  averaging?: Averaging
  /** Warn when mean judged@k is below this. */
  judgedThreshold?: number
  /** Pool depth in use; a k above it is flagged. */
  poolDepth?: number
}

export interface CompareRow {
  name: string
  contribute: boolean
  mean: QueryMetrics
  queries: number
  /** Queries with judgments but no results from this run. */
  missing: number
  /** judged@k is below the threshold: the other numbers may be too low. */
  biasWarning: boolean
}

export interface Comparison {
  rows: CompareRow[]
  k: number
  /** True when k exceeds the pool depth, so judged@k cannot reach 1. */
  kExceedsPoolDepth: boolean
  threshold: number
}

export function compareRuns(runs: NamedRun[], qrels: Qrels, options: CompareOptions): Comparison {
  const threshold = options.judgedThreshold ?? DEFAULT_JUDGED_THRESHOLD
  const rows = runs.map((run): CompareRow => {
    const evaluation = evaluateRun(
      run.entries,
      qrels,
      { k: options.k, minRel: options.minRel ?? 1 },
      options.averaging ?? 'common',
    )
    return {
      name: run.name,
      contribute: run.contribute,
      mean: evaluation.mean,
      queries: evaluation.queries,
      missing: evaluation.missing,
      biasWarning: evaluation.queries > 0 && evaluation.mean.judged < threshold,
    }
  })
  return {
    rows,
    k: options.k,
    kExceedsPoolDepth: options.poolDepth !== undefined && options.k > options.poolDepth,
    threshold,
  }
}
