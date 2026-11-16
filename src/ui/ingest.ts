// Reads a dropped file: sniff the format from the first 64 KB, then stream-parse.

import { readBackup } from '../core/export'
import { detectFormat, parseCorpus, parseQrels, parseQueries, parseRun, type FileFormat } from '../core/parse'
import type { Doc, ParseIssue, Qrels, RunEntries, SessionState } from '../core/types'

export type Loaded =
  | { kind: 'run'; name: string; format: FileFormat; entries: RunEntries; issues: ParseIssue[]; count: number }
  | { kind: 'queries'; queries: Map<string, string>; issues: ParseIssue[]; count: number }
  | { kind: 'corpus'; docs: Map<string, Doc>; issues: ParseIssue[]; count: number }
  | { kind: 'qrels'; qrels: Qrels; issues: ParseIssue[]; count: number }
  | { kind: 'backup'; state: SessionState | undefined; issues: ParseIssue[]; count: number }
  | { kind: 'unknown'; issues: ParseIssue[]; count: 0 }

function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export async function readInputFile(file: File, maxDepth: number): Promise<Loaded> {
  const sample = await file.slice(0, 65536).text()
  const format = detectFormat(sample, file.name)
  switch (format) {
    case 'trec-run':
    case 'jsonl-run':
    case 'csv-run': {
      const r = await parseRun(file.stream(), { format, maxDepth })
      return { kind: 'run', name: baseName(file.name), format, entries: r.entries, issues: r.issues, count: r.lines }
    }
    case 'beir-queries':
    case 'queries-tsv': {
      const r = await parseQueries(file.stream())
      return { kind: 'queries', queries: r.queries, issues: r.issues, count: r.queries.size }
    }
    case 'beir-corpus': {
      const r = await parseCorpus(file.stream())
      return { kind: 'corpus', docs: r.docs, issues: r.issues, count: r.docs.size }
    }
    case 'trec-qrels':
    case 'beir-qrels': {
      const r = await parseQrels(file.stream())
      let n = 0
      for (const inner of r.qrels.values()) n += inner.size
      return { kind: 'qrels', qrels: r.qrels, issues: r.issues, count: n }
    }
    case 'backup': {
      const r = await readBackup(file.stream())
      return { kind: 'backup', state: r.state, issues: r.issues, count: r.state?.judgments.size ?? 0 }
    }
    default:
      return { kind: 'unknown', issues: [{ line: 1, code: sample.trim() === '' ? 'file.empty' : 'file.unknown' }], count: 0 }
  }
}
