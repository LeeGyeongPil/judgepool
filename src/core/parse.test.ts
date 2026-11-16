import { describe, expect, test } from 'vitest'
import { detectFormat, parseCorpus, parseQrels, parseQueries, parseRun, splitCsvLine } from './parse'

const ids = (r: Awaited<ReturnType<typeof parseRun>>, q: string) => r.entries.get(q)!.map((e) => e.docId)

describe('detectFormat', () => {
  test.each([
    ['q1 Q0 d1 1 9.5 bm25', 'trec-run'],
    ['{"query_id":"q1","doc_id":"d1","score":1}', 'jsonl-run'],
    ['query_id,doc_id,score\nq1,d1,1', 'csv-run'],
    ['{"_id":"q1","text":"how"}', 'beir-queries'],
    ['{"_id":"d1","title":"t","text":"body"}', 'beir-corpus'],
    ['q1\thow do I', 'queries-tsv'],
    ['query-id\tcorpus-id\tscore\nq1\td1\t1', 'beir-qrels'],
    ['q1\td1\t2', 'beir-qrels'],
    ['q1 0 d1 2', 'trec-qrels'],
    ['{"judgepool":1,"t":"meta"}', 'backup'],
    ['garbage', 'unknown'],
    ['', 'unknown'],
  ])('%j -> %s', (sample, expected) => {
    expect(detectFormat(sample)).toBe(expected)
  })

  test('ignores a BOM and leading blank lines', () => {
    expect(detectFormat('﻿\n\nq1 Q0 d1 1 2.0 x')).toBe('trec-run')
  })
})

describe('parseRun', () => {
  test('TREC: sorts by score desc, ties by doc id desc, ignores rank', async () => {
    const r = await parseRun('q1 Q0 a 1 1.0 t\nq1 Q0 b 2 2.0 t\nq1 Q0 c 3 1.0 t\n')
    expect(r.format).toBe('trec-run')
    expect(ids(r, 'q1')).toEqual(['b', 'c', 'a'])
  })

  test('JSONL with only rank becomes score = -rank', async () => {
    const r = await parseRun('{"query_id":"q1","doc_id":"x","rank":2}\n{"query_id":"q1","doc_id":"y","rank":1}\n')
    expect(r.format).toBe('jsonl-run')
    expect(ids(r, 'q1')).toEqual(['y', 'x'])
    expect(r.entries.get('q1')![0].score).toBe(-1)
  })

  test('JSONL keeps passage text and accepts alias keys', async () => {
    const r = await parseRun('{"qid":"q1","docid":"x","score":3,"text":"hello"}\n')
    expect(r.entries.get('q1')![0]).toEqual({ docId: 'x', score: 3, text: 'hello' })
  })

  test('CSV with header, quoted text and rank only', async () => {
    const r = await parseRun('query_id,doc_id,rank,text\nq1,a,2,"hi, there"\nq1,b,1,plain\n')
    expect(r.format).toBe('csv-run')
    expect(ids(r, 'q1')).toEqual(['b', 'a'])
    expect(r.entries.get('q1')![1].text).toBe('hi, there')
  })

  test('maxDepth keeps only the best N per query', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `q1 Q0 d${i} ${i} ${i}.0 t`).join('\n')
    const r = await parseRun(lines, { maxDepth: 5 })
    expect(ids(r, 'q1')).toEqual(['d49', 'd48', 'd47', 'd46', 'd45'])
  })

  test('a repeated doc id keeps its best score', async () => {
    const r = await parseRun('q1 Q0 a 1 1.0 t\nq1 Q0 a 2 5.0 t\n')
    expect(r.entries.get('q1')).toEqual([{ docId: 'a', score: 5 }])
  })

  test('bad lines are reported with line numbers and do not throw', async () => {
    const r = await parseRun('q1 Q0 a 1 1.0 t\n\nq1 Q0 b 2\nq1 Q0 c 3 nan t\nq1 Q0 d 4 0.5 t\n')
    expect(r.issues.map((i) => i.line)).toEqual([3, 4])
    expect(r.issues[0]).toEqual({ line: 3, code: 'trec.run.cols', vars: { found: 4 } })
    expect(ids(r, 'q1')).toEqual(['a', 'd'])
  })

  test('JSONL problems: not JSON, missing ids, no score or rank', async () => {
    const r = await parseRun('{"query_id":"q1","doc_id":"a","score":1}\nnot json\n{"query_id":"q1"}\n{"query_id":"q1","doc_id":"b"}\n', {
      format: 'jsonl-run',
    })
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4])
  })

  test('an unrecognisable file is reported once', async () => {
    const r = await parseRun('hello world\n')
    expect(r.issues).toHaveLength(1)
    expect(r.entries.size).toBe(0)
  })

  test('handles CRLF and BOM', async () => {
    const r = await parseRun('﻿q1 Q0 a 1 1.0 t\r\nq1 Q0 b 2 0.5 t\r\n')
    expect(ids(r, 'q1')).toEqual(['a', 'b'])
  })
})

describe('splitCsvLine', () => {
  test('quotes and doubled quotes', () => {
    expect(splitCsvLine('a,"b,c","say ""hi""",')).toEqual(['a', 'b,c', 'say "hi"', ''])
  })
})

describe('queries and corpus', () => {
  test('BEIR queries.jsonl and TSV', async () => {
    const a = await parseQueries('{"_id":"q1","text":"first"}\n{"_id":"q2","text":"second","metadata":{}}\n')
    expect([...a.queries]).toEqual([['q1', 'first'], ['q2', 'second']])
    const b = await parseQueries('q1\tfirst one\nbroken\n')
    expect(b.queries.get('q1')).toBe('first one')
    expect(b.issues).toEqual([{ line: 2, code: 'queries.tab' }])
  })

  test('BEIR corpus.jsonl with and without title', async () => {
    const r = await parseCorpus('{"_id":"d1","title":"T","text":"body"}\n{"_id":"d2","text":"x"}\n{"text":"no id"}\n')
    expect(r.docs.get('d1')).toEqual({ title: 'T', text: 'body' })
    expect(r.docs.get('d2')).toEqual({ text: 'x' })
    expect(r.issues.map((i) => i.line)).toEqual([3])
  })
})

describe('parseQrels', () => {
  test('TREC qrels', async () => {
    const r = await parseQrels('q1 0 d1 3\nq1 0 d2 -1\nq2 0 d9 0\n')
    expect(r.format).toBe('trec-qrels')
    expect(r.qrels.get('q1')!.get('d2')).toBe(-1)
    expect(r.qrels.size).toBe(2)
  })

  test('BEIR TSV with header', async () => {
    const r = await parseQrels('query-id\tcorpus-id\tscore\nq1\td1\t2\n')
    expect(r.format).toBe('beir-qrels')
    expect([...r.qrels.get('q1')!]).toEqual([['d1', 2]])
    expect(r.issues).toEqual([])
  })

  test('bad relevance and short lines are line-numbered', async () => {
    const r = await parseQrels('q1 0 d1 x\nq1 0 d2\nq1 0 d3 1\n')
    expect(r.issues.map((i) => i.line)).toEqual([1, 2])
    expect(r.qrels.get('q1')!.get('d3')).toBe(1)
  })
})

describe('title-less corpus detection', () => {
  const line = '{"_id":"d1","text":"Reset the router by holding the button."}'
  test('the file name breaks the tie between queries and a corpus', () => {
    expect(detectFormat(line, 'corpus.jsonl')).toBe('beir-corpus')
    expect(detectFormat(line, 'queries.jsonl')).toBe('beir-queries')
  })
  test('without a file name a long text counts as a passage', () => {
    expect(detectFormat(line)).toBe('beir-queries')
    expect(detectFormat(`{"_id":"d1","text":"${'x'.repeat(400)}"}`)).toBe('beir-corpus')
  })
  test('a corpus without titles parses into documents', async () => {
    const r = await parseCorpus(`${line}\n`)
    expect(r.docs.get('d1')).toEqual({ text: 'Reset the router by holding the button.' })
  })
})
