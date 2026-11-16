// The bundled synthetic example (invented "Lumen Notes" help passages).
import { parseCorpus, parseQueries, parseRun } from '../core/parse'
import type { Doc, NamedRun } from '../core/types'
import bm25Text from './bm25.run?raw'
import corpusText from './corpus.jsonl?raw'
import denseText from './dense.run?raw'
import hybridText from './hybrid.run?raw'
import judgmentsText from './judgments.jsonl?raw'
import queriesText from './queries.jsonl?raw'

export interface ExampleData {
  queries: Map<string, string>
  docs: Map<string, Doc>
  /** Only bm25 contributes to the pool at the start (that is the lesson). */
  runs: NamedRun[]
  /** query id -> doc id -> grade, used by "Fill example judgments". */
  grades: Map<string, Map<string, number>>
}

export async function loadExample(): Promise<ExampleData> {
  const queries = (await parseQueries(queriesText)).queries
  const docs = (await parseCorpus(corpusText)).docs
  const runs: NamedRun[] = []
  for (const [name, text] of [
    ['bm25', bm25Text],
    ['dense', denseText],
    ['hybrid', hybridText],
  ] as const) {
    runs.push({ name, contribute: name === 'bm25', entries: (await parseRun(text)).entries })
  }
  const grades = new Map<string, Map<string, number>>()
  for (const line of judgmentsText.split('\n')) {
    if (line.trim() === '') continue
    const j = JSON.parse(line) as { query_id: string; doc_id: string; grade: number }
    const inner = grades.get(j.query_id) ?? new Map<string, number>()
    inner.set(j.doc_id, j.grade)
    grades.set(j.query_id, inner)
  }
  return { queries, docs, runs, grades }
}
