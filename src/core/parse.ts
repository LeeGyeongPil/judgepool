// Parsers for run, query, corpus and qrels files.
// They never throw on bad lines: problems are collected with line numbers.

import { splitLines, type LineSource } from './lines'
import type { Doc, IssueInfo, ParseIssue, Qrels, RunEntries, RunEntry } from './types'

export type FileFormat =
  | 'trec-run'
  | 'jsonl-run'
  | 'csv-run'
  | 'beir-queries'
  | 'queries-tsv'
  | 'beir-corpus'
  | 'trec-qrels'
  | 'beir-qrels'
  | 'backup'
  | 'unknown'

export const DEFAULT_MAX_DEPTH = 100

/** trec_eval ordering: score descending, ties by doc id descending. */
export function compareEntries(a: RunEntry, b: RunEntry): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.docId === b.docId) return 0
  return a.docId < b.docId ? 1 : -1
}

function tryJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // not JSON
  }
  return undefined
}

function firstOf(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (key in obj) return obj[key]
  return undefined
}

/** Guess the file format from a sample (the first few KB) of the file. */
export function detectFormat(sample: string, fileName?: string): FileFormat {
  const text = sample.charCodeAt(0) === 0xfeff ? sample.slice(1) : sample
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '')
  if (line === undefined) return 'unknown'
  const trimmed = line.trim()
  if (trimmed.startsWith('{')) {
    const obj = tryJson(trimmed)
    if (!obj) return 'unknown'
    if ('judgepool' in obj) return 'backup'
    if ('query_id' in obj || 'qid' in obj || 'query-id' in obj) return 'jsonl-run'
    if ('_id' in obj && 'title' in obj) return 'beir-corpus'
    if ('_id' in obj && 'text' in obj) {
      // Queries and title-less corpora look alike: a long text or the file name decides.
      if (fileName && /corpus|passage|doc/i.test(fileName)) return 'beir-corpus'
      if (fileName && /quer/i.test(fileName)) return 'beir-queries'
      return typeof obj.text === 'string' && obj.text.length > 300 ? 'beir-corpus' : 'beir-queries'
    }
    return 'unknown'
  }
  const lower = trimmed.toLowerCase()
  if (lower === 'query-id\tcorpus-id\tscore') return 'beir-qrels'
  if (lower.includes(',') && /(^|,)\s*"?(query_id|qid)"?\s*(,|$)/.test(lower)) return 'csv-run'
  if (trimmed.includes('\t')) {
    const cols = trimmed.split('\t')
    if (cols.length === 2) return 'queries-tsv'
    if (cols.length === 3 && /^-?\d+$/.test(cols[2].trim())) return 'beir-qrels'
  }
  const cols = trimmed.split(/\s+/)
  if (cols.length >= 6 && Number.isFinite(Number(cols[4]))) return 'trec-run'
  if (cols.length === 4 && /^-?\d+$/.test(cols[3])) return 'trec-qrels'
  return 'unknown'
}

/** Minimal one-line CSV splitter (supports quotes and doubled quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export interface RunParseResult {
  entries: RunEntries
  issues: ParseIssue[]
  format: FileFormat
  lines: number
}

export interface RunParseOptions {
  format?: FileFormat
  /** Keep only each query's top-N documents (memory bound). */
  maxDepth?: number
}

interface RawRow {
  qid: string
  docId: string
  score?: number
  rank?: number
  text?: string
}

function finishList(list: RunEntry[], maxDepth: number): RunEntry[] {
  list.sort(compareEntries)
  const seen = new Set<string>()
  const out: RunEntry[] = []
  for (const entry of list) {
    if (seen.has(entry.docId)) continue
    seen.add(entry.docId)
    out.push(entry)
    if (out.length >= maxDepth) break
  }
  return out
}

function rowFromJson(obj: Record<string, unknown>): RawRow | IssueInfo {
  const qid = firstOf(obj, ['query_id', 'qid', 'query-id'])
  const docId = firstOf(obj, ['doc_id', 'docid', 'doc-id', 'corpus-id'])
  if (qid === undefined || docId === undefined) return { code: 'run.ids' }
  const score = firstOf(obj, ['score'])
  const rank = firstOf(obj, ['rank'])
  const text = firstOf(obj, ['text'])
  const row: RawRow = { qid: String(qid), docId: String(docId) }
  if (score !== undefined && score !== null && score !== '') {
    if (!Number.isFinite(Number(score))) return { code: 'score.nan', vars: { value: String(score) } }
    row.score = Number(score)
  }
  if (rank !== undefined && rank !== null && rank !== '') {
    if (!Number.isFinite(Number(rank))) return { code: 'rank.nan', vars: { value: String(rank) } }
    row.rank = Number(rank)
  }
  if (typeof text === 'string' && text !== '') row.text = text
  return row
}

export async function parseRun(source: LineSource, options: RunParseOptions = {}): Promise<RunParseResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const issues: ParseIssue[] = []
  const lists = new Map<string, RunEntry[]>()
  let format: FileFormat | undefined = options.format
  let header: string[] | undefined
  let lines = 0

  const add = (row: RawRow, lineNo: number) => {
    let score = row.score
    if (score === undefined) {
      if (row.rank === undefined) {
        issues.push({ line: lineNo, code: 'run.noscore' })
        return
      }
      score = -row.rank
    }
    let list = lists.get(row.qid)
    if (!list) {
      list = []
      lists.set(row.qid, list)
    }
    const entry: RunEntry = { docId: row.docId, score }
    if (row.text !== undefined) entry.text = row.text
    list.push(entry)
    if (list.length > maxDepth * 2 + 16) lists.set(row.qid, finishList(list, maxDepth))
  }

  for await (const { no, text } of splitLines(source)) {
    if (text.trim() === '') continue
    lines += 1
    if (!format) {
      format = detectFormat(text)
      if (format !== 'trec-run' && format !== 'jsonl-run' && format !== 'csv-run') {
        issues.push({ line: no, code: 'run.format' })
        break
      }
    }
    if (format === 'jsonl-run') {
      const obj = tryJson(text.trim())
      if (!obj) {
        issues.push({ line: no, code: 'json.object' })
        continue
      }
      const row = rowFromJson(obj)
      if ('code' in row) issues.push({ line: no, ...row })
      else add(row, no)
    } else if (format === 'csv-run') {
      const cells = splitCsvLine(text)
      if (!header) {
        header = cells.map((c) => c.trim().toLowerCase())
        if (!header.some((h) => h === 'query_id' || h === 'qid') || !header.some((h) => h === 'doc_id' || h === 'docid')) {
          issues.push({ line: no, code: 'csv.header' })
          break
        }
        continue
      }
      const obj: Record<string, unknown> = {}
      header.forEach((h, i) => {
        if (cells[i] !== undefined) obj[h] = cells[i]
      })
      const row = rowFromJson(obj)
      if ('code' in row) issues.push({ line: no, ...row })
      else add(row, no)
    } else {
      const cols = text.trim().split(/\s+/)
      if (cols.length < 6) {
        issues.push({ line: no, code: 'trec.run.cols', vars: { found: cols.length } })
        continue
      }
      const score = Number(cols[4])
      if (!Number.isFinite(score)) {
        issues.push({ line: no, code: 'score.nan', vars: { value: cols[4] } })
        continue
      }
      add({ qid: cols[0], docId: cols[2], score }, no)
    }
  }

  const entries: RunEntries = new Map()
  for (const [qid, list] of lists) entries.set(qid, finishList(list, maxDepth))
  return { entries, issues, format: format ?? 'unknown', lines }
}

export interface QueriesParseResult {
  queries: Map<string, string>
  issues: ParseIssue[]
}

export async function parseQueries(source: LineSource): Promise<QueriesParseResult> {
  const queries = new Map<string, string>()
  const issues: ParseIssue[] = []
  for await (const { no, text } of splitLines(source)) {
    if (text.trim() === '') continue
    if (text.trim().startsWith('{')) {
      const obj = tryJson(text.trim())
      if (!obj) {
        issues.push({ line: no, code: 'json.object' })
        continue
      }
      const id = firstOf(obj, ['_id', 'query_id', 'qid', 'id'])
      const body = firstOf(obj, ['text', 'query'])
      if (id === undefined || typeof body !== 'string') {
        issues.push({ line: no, code: 'rec.idtext' })
        continue
      }
      queries.set(String(id), body)
    } else {
      const tab = text.indexOf('\t')
      if (tab <= 0) {
        issues.push({ line: no, code: 'queries.tab' })
        continue
      }
      queries.set(text.slice(0, tab).trim(), text.slice(tab + 1).trim())
    }
  }
  return { queries, issues }
}

export interface CorpusParseResult {
  docs: Map<string, Doc>
  issues: ParseIssue[]
}

export async function parseCorpus(source: LineSource): Promise<CorpusParseResult> {
  const docs = new Map<string, Doc>()
  const issues: ParseIssue[] = []
  for await (const { no, text } of splitLines(source)) {
    if (text.trim() === '') continue
    const obj = tryJson(text.trim())
    if (!obj) {
      issues.push({ line: no, code: 'json.object' })
      continue
    }
    const id = firstOf(obj, ['_id', 'doc_id', 'id'])
    const body = firstOf(obj, ['text'])
    if (id === undefined || typeof body !== 'string') {
      issues.push({ line: no, code: 'rec.idtext' })
      continue
    }
    const title = firstOf(obj, ['title'])
    const doc: Doc = { text: body }
    if (typeof title === 'string' && title !== '') doc.title = title
    docs.set(String(id), doc)
  }
  return { docs, issues }
}

export interface QrelsParseResult {
  qrels: Qrels
  issues: ParseIssue[]
  format: FileFormat
}

export async function parseQrels(source: LineSource): Promise<QrelsParseResult> {
  const qrels: Qrels = new Map()
  const issues: ParseIssue[] = []
  let format: FileFormat = 'unknown'
  const put = (qid: string, docId: string, relText: string, no: number) => {
    if (!/^-?\d+$/.test(relText)) {
      issues.push({ line: no, code: 'qrels.int', vars: { value: relText } })
      return
    }
    let inner = qrels.get(qid)
    if (!inner) {
      inner = new Map()
      qrels.set(qid, inner)
    }
    inner.set(docId, Number(relText))
  }
  for await (const { no, text } of splitLines(source)) {
    if (text.trim() === '') continue
    if (format === 'unknown') {
      const guessed = detectFormat(text)
      if (guessed === 'beir-qrels' || guessed === 'trec-qrels') {
        format = guessed
        if (text.trim().toLowerCase() === 'query-id\tcorpus-id\tscore') continue
      } else if (text.includes('\t')) format = 'beir-qrels'
      else format = 'trec-qrels'
    }
    if (format === 'beir-qrels') {
      const cols = text.split('\t')
      if (cols.length < 3) {
        issues.push({ line: no, code: 'qrels.beir.cols', vars: { found: cols.length } })
        continue
      }
      put(cols[0].trim(), cols[1].trim(), cols[2].trim(), no)
    } else {
      const cols = text.trim().split(/\s+/)
      if (cols.length < 4) {
        issues.push({ line: no, code: 'qrels.trec.cols', vars: { found: cols.length } })
        continue
      }
      put(cols[0], cols[2], cols[3], no)
    }
  }
  return { qrels, issues, format }
}
