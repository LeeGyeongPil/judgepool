import { describe, expect, test } from 'vitest'
import { exampleFile, fixture, refCases, type RefCase } from './__fixtures__/load'
import { evaluateRun, queryMetrics, type Averaging, type QueryMetrics } from './metrics'
import { parseQrels, parseRun } from './parse'

const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-6)

function compareMean(mean: QueryMetrics, other: QueryMetrics, ref: Record<string, number>) {
  close(mean.ndcg, ref.ndcg)
  close(mean.recall, ref.recall)
  close(mean.precision, ref.precision)
  close(mean.rr, ref.rr)
  close(mean.judged, ref.judged)
  close(other.recall, ref.recall2)
  close(other.precision, ref.precision2)
  close(other.rr, ref.rr2)
}

async function load(c: RefCase) {
  const qrels = (await parseQrels(fixture(c.qrels))).qrels
  const runText = c.run.startsWith('src/core/__fixtures__/')
    ? fixture(c.run.replace('src/core/__fixtures__/', ''))
    : exampleFile(c.run.replace('src/example/', ''))
  const run = (await parseRun(runText)).entries
  return { qrels, run }
}

describe('metrics match ir_measures reference values (6 decimals)', () => {
  for (const c of refCases()) {
    for (const averaging of ['trec', 'common'] as Averaging[]) {
      test(`${c.name}@${c.k} [${averaging}]`, async () => {
        const { qrels, run } = await load(c)
        const rel1 = evaluateRun(run, qrels, { k: c.k, minRel: 1 }, averaging)
        const rel2 = evaluateRun(run, qrels, { k: c.k, minRel: 2 }, averaging)
        compareMean(rel1.mean, rel2.mean, c[averaging])
      })
    }

    test(`${c.name}@${c.k} per-query values`, async () => {
      const { qrels, run } = await load(c)
      const rel1 = evaluateRun(run, qrels, { k: c.k, minRel: 1 }, 'common')
      const rel2 = evaluateRun(run, qrels, { k: c.k, minRel: 2 }, 'common')
      for (const [qid, ref] of Object.entries(c.per_query)) {
        const a = rel1.perQuery.get(qid)!
        const b = rel2.perQuery.get(qid)!
        expect(a, `query ${qid}`).toBeDefined()
        close(a.ndcg, ref.ndcg)
        close(a.recall, ref.recall)
        close(a.precision, ref.precision)
        close(a.rr, ref.rr)
        close(a.judged, ref.judged)
        close(b.recall, ref.recall2)
        close(b.precision, ref.precision2)
        close(b.rr, ref.rr2)
      }
    })
  }
})

describe('probe fixture values from the research notes', () => {
  test('runA nDCG@3 0.434909 and runB nDCG@3 0.933752', async () => {
    const qrels = (await parseQrels(fixture('probe_qrels.txt'))).qrels
    const a = evaluateRun((await parseRun(fixture('probe_runA.txt'))).entries, qrels, { k: 3 }, 'trec')
    const b = evaluateRun((await parseRun(fixture('probe_runB.txt'))).entries, qrels, { k: 3 }, 'trec')
    expect(a.mean.ndcg.toFixed(6)).toBe('0.434909')
    expect(b.mean.ndcg.toFixed(6)).toBe('0.933752')
  })
})

describe('trec_eval conventions', () => {
  test('ties are broken by doc id descending, not by file order', () => {
    // Equal scores: the parser orders z before a, so the irrelevant doc comes first.
    return parseRun('q Q0 a 1 5.0 t\nq Q0 z 2 5.0 t\n').then((r) => {
      expect(r.entries.get('q')!.map((e) => e.docId)).toEqual(['z', 'a'])
      const qrels = new Map([['q', new Map([['a', 1]])]])
      expect(evaluateRun(r.entries, qrels, { k: 2 }, 'trec').mean.rr).toBe(0.5)
    })
  })

  test('the rank column is ignored', () => {
    return parseRun('q Q0 a 9 1.0 t\nq Q0 b 1 2.0 t\n').then((r) => {
      expect(r.entries.get('q')!.map((e) => e.docId)).toEqual(['b', 'a'])
    })
  })

  test('a query without relevant documents scores 0 and does not throw', () => {
    const m = queryMetrics(['a', 'b'], new Map([['a', 0]]), { k: 2 })
    expect(m).toEqual({ ndcg: 0, recall: 0, precision: 0, rr: 0, judged: 0.5 })
  })

  test('negative grades add no gain but count as judged', () => {
    const m = queryMetrics(['a', 'b'], new Map([['a', -1], ['b', 2]]), { k: 2 })
    expect(m.judged).toBe(1)
    expect(m.ndcg).toBeCloseTo(2 / Math.log2(3) / 2, 10)
  })

  test("'trec' skips queries the run lacks; 'common' scores them 0", () => {
    const qrels = new Map([
      ['q1', new Map([['a', 1]])],
      ['q2', new Map([['b', 1]])],
    ])
    const run = new Map([['q1', [{ docId: 'a', score: 1 }]]])
    const trec = evaluateRun(run, qrels, { k: 1 }, 'trec')
    const common = evaluateRun(run, qrels, { k: 1 }, 'common')
    expect(trec.mean.precision).toBe(1)
    expect(trec.queries).toBe(1)
    expect(common.mean.precision).toBe(0.5)
    expect(common.queries).toBe(2)
    expect(common.missing).toBe(1)
  })

  test('precision divides by k even when the run is shorter', () => {
    expect(queryMetrics(['a'], new Map([['a', 1]]), { k: 4 }).precision).toBe(0.25)
  })
})
