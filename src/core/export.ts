// Export (TREC qrels, BEIR TSV, JSONL backup) and backup import.

import { splitLines, type LineSource } from './lines'
import { judgmentsToQrels } from './session'
import type {
  Doc,
  HistoryRecord,
  JudgmentEntry,
  NamedRun,
  ParseIssue,
  PoolItem,
  Qrels,
  RunEntry,
  SessionState,
} from './types'

function orderedQueries(state: SessionState, qrels: Qrels): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const qid of [...state.queryOrder, ...qrels.keys()]) {
    if (qrels.has(qid) && !seen.has(qid)) {
      seen.add(qid)
      out.push(qid)
    }
  }
  return out
}

function qrelsRows(state: SessionState): [string, string, number][] {
  const qrels = judgmentsToQrels(state)
  const rows: [string, string, number][] = []
  for (const qid of orderedQueries(state, qrels)) {
    const inner = qrels.get(qid)!
    for (const docId of [...inner.keys()].sort()) rows.push([qid, docId, inner.get(docId)!])
  }
  return rows
}

/** TREC qrels: `qid 0 docid rel`. Skipped and unjudged items are not written. */
export function exportTrecQrels(state: SessionState): string {
  const lines = qrelsRows(state).map(([q, d, r]) => `${q} 0 ${d} ${r}`)
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/** BEIR qrels TSV with the `query-id\tcorpus-id\tscore` header. */
export function exportBeirTsv(state: SessionState): string {
  const body = qrelsRows(state).map(([q, d, r]) => `${q}\t${d}\t${r}`)
  return ['query-id\tcorpus-id\tscore', ...body].join('\n') + '\n'
}

// ---- JSONL backup -------------------------------------------------------

type BackupLine =
  | { t: 'meta'; judgepool: 1; judge: string; seed: string; depth: number; dedupeByText: boolean; cursor: number; order: string[]; queryOrder: string[] }
  | { t: 'query'; id: string; text: string }
  | { t: 'run'; name: string; contribute: boolean }
  | { t: 'runq'; name: string; qid: string; entries: RunEntry[] }
  | { t: 'base'; qid: string; docs: [string, number][] }
  | { t: 'doc'; id: string; doc: Doc }
  | { t: 'item'; item: PoolItem }
  | { t: 'entry'; id: string; entry: JudgmentEntry }
  | { t: 'history'; records: HistoryRecord[] }

/** Full session backup, one JSON object per line. Round-trips through readBackup. */
export function writeBackup(state: SessionState): string {
  const out: BackupLine[] = [
    {
      t: 'meta',
      judgepool: 1,
      judge: state.judge,
      seed: state.seed,
      depth: state.config.depth,
      dedupeByText: state.config.dedupeByText,
      cursor: state.cursor,
      order: state.order,
      queryOrder: state.queryOrder,
    },
  ]
  for (const [id, text] of state.queries) out.push({ t: 'query', id, text })
  for (const run of state.runs) {
    out.push({ t: 'run', name: run.name, contribute: run.contribute })
    for (const [qid, entries] of run.entries) out.push({ t: 'runq', name: run.name, qid, entries })
  }
  for (const [qid, docs] of state.baseQrels) out.push({ t: 'base', qid, docs: [...docs] })
  for (const [id, doc] of state.docs) out.push({ t: 'doc', id, doc })
  for (const item of state.items) out.push({ t: 'item', item })
  for (const [id, entry] of state.judgments) out.push({ t: 'entry', id, entry })
  out.push({ t: 'history', records: state.history })
  return out.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

export interface BackupResult {
  state?: SessionState
  issues: ParseIssue[]
}

export async function readBackup(source: LineSource): Promise<BackupResult> {
  const issues: ParseIssue[] = []
  const queries = new Map<string, string>()
  const runs = new Map<string, NamedRun>()
  const baseQrels: Qrels = new Map()
  const docs = new Map<string, Doc>()
  const items: PoolItem[] = []
  const judgments = new Map<string, JudgmentEntry>()
  let history: HistoryRecord[] = []
  let meta: Extract<BackupLine, { t: 'meta' }> | undefined

  for await (const { no, text } of splitLines(source)) {
    if (text.trim() === '') continue
    let line: BackupLine
    try {
      line = JSON.parse(text) as BackupLine
    } catch {
      issues.push({ line: no, code: 'json.invalid' })
      continue
    }
    switch (line.t) {
      case 'meta':
        meta = line
        break
      case 'query':
        queries.set(line.id, line.text)
        break
      case 'run':
        runs.set(line.name, { name: line.name, contribute: line.contribute, entries: new Map() })
        break
      case 'runq': {
        const run = runs.get(line.name)
        if (!run) issues.push({ line: no, code: 'backup.run', vars: { name: String(line.name) } })
        else run.entries.set(line.qid, line.entries)
        break
      }
      case 'base':
        baseQrels.set(line.qid, new Map(line.docs))
        break
      case 'doc':
        docs.set(line.id, line.doc)
        break
      case 'item':
        items.push(line.item)
        break
      case 'entry':
        judgments.set(line.id, line.entry)
        break
      case 'history':
        history = line.records
        break
      default:
        issues.push({ line: no, code: 'backup.type' })
    }
  }
  if (!meta) {
    issues.push({ line: 1, code: 'backup.meta' })
    return { issues }
  }
  const state: SessionState = {
    version: 1,
    judge: meta.judge,
    seed: meta.seed,
    config: { depth: meta.depth, dedupeByText: meta.dedupeByText },
    runs: [...runs.values()],
    queries,
    queryOrder: meta.queryOrder,
    docs,
    baseQrels,
    items,
    order: meta.order,
    judgments,
    history,
    cursor: meta.cursor,
  }
  return { state, issues }
}
