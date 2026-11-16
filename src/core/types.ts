// Shared data types. Everything the session needs is held in plain data
// (Maps, arrays, strings) so it survives structuredClone / IndexedDB.

/** One retrieved document in a run (after sorting and depth truncation). */
export interface RunEntry {
  docId: string
  score: number
  /** Passage text, when the run file carried it (JSONL/CSV `text`). */
  text?: string
}

/** query id -> ranked entries (score descending, ties by doc id descending). */
export type RunEntries = Map<string, RunEntry[]>

export interface NamedRun {
  name: string
  /** Does this run contribute documents to the judging pool? */
  contribute: boolean
  entries: RunEntries
}

/** query id -> doc id -> graded relevance (may be negative). */
export type Qrels = Map<string, Map<string, number>>

export interface Doc {
  title?: string
  text: string
}

/** What went wrong, as a message key (screens translate it) plus values. */
export interface IssueInfo {
  code: string
  vars?: Record<string, string | number>
}

export interface ParseIssue extends IssueInfo {
  /** 1-based line number in the source file. */
  line: number
}

export interface PoolConfig {
  /** Pool depth k: take each contributing run's top-k per query. */
  depth: number
  /** Merge pool items whose normalised text is identical. */
  dedupeByText: boolean
}

/** One unit to judge: a query plus one passage (possibly several doc ids). */
export interface PoolItem {
  id: string
  qid: string
  /** Original doc ids that share this item (more than one when text-merged). */
  docIds: string[]
  title?: string
  text: string
}

/** What the judging screen is allowed to see. No run name, no rank. */
export interface BlindItem {
  id: string
  qid: string
  queryText: string
  title?: string
  text: string
}

export type Grade = 0 | 1 | 2 | 3

export type JudgmentEntry = { kind: 'grade'; grade: Grade; at: number } | { kind: 'skip'; at: number }

export interface HistoryRecord {
  itemId: string
  /** Entry before the action (undefined = none). */
  prev: JudgmentEntry | undefined
  cursor: number
}

export interface SessionState {
  version: 1
  judge: string
  seed: string
  config: PoolConfig
  runs: NamedRun[]
  queries: Map<string, string>
  /** Query ids in display order. */
  queryOrder: string[]
  /** Passage texts for docs that appear in the runs (needed when the pool grows). */
  docs: Map<string, Doc>
  /** Existing qrels imported by the user (kept under new judgments). */
  baseQrels: Qrels
  items: PoolItem[]
  /** Item ids in blind presentation order. */
  order: string[]
  judgments: Map<string, JudgmentEntry>
  history: HistoryRecord[]
  cursor: number
}
