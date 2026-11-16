import { describe, expect, test } from 'vitest'
import { splitLines } from './lines'

async function collect(source: Parameters<typeof splitLines>[0]) {
  const out: { no: number; text: string }[] = []
  for await (const line of splitLines(source)) out.push(line)
  return out
}

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p)
      controller.close()
    },
  })
}

describe('splitLines', () => {
  test('splits LF and CRLF and numbers lines from 1', async () => {
    expect(await collect('a\r\nb\nc')).toEqual([
      { no: 1, text: 'a' },
      { no: 2, text: 'b' },
      { no: 3, text: 'c' },
    ])
  })

  test('strips a leading BOM', async () => {
    expect((await collect('﻿q1\tq'))[0].text).toBe('q1\tq')
  })

  test('strips a BOM that arrives as bytes', async () => {
    const bytes = new TextEncoder().encode('﻿hello\n')
    expect((await collect(streamOf([bytes])))[0].text).toBe('hello')
  })

  test('joins a line split across chunks', async () => {
    const bytes = new TextEncoder().encode('alpha beta\ngamma\n')
    const lines = await collect(streamOf([bytes.slice(0, 3), bytes.slice(3, 13), bytes.slice(13)]))
    expect(lines.map((l) => l.text)).toEqual(['alpha beta', 'gamma'])
  })

  test('keeps a multi-byte character that is cut between chunks', async () => {
    const bytes = new TextEncoder().encode('한국어 문서\n')
    const lines = await collect(streamOf([bytes.slice(0, 4), bytes.slice(4)]))
    expect(lines).toEqual([{ no: 1, text: '한국어 문서' }])
  })

  test('handles CR and LF landing in different chunks', async () => {
    const lines = await collect(streamOf([new TextEncoder().encode('a\r'), new TextEncoder().encode('\nb\r\n')]))
    expect(lines.map((l) => l.text)).toEqual(['a', 'b'])
  })

  test('empty input yields nothing; a final empty line is not invented', async () => {
    expect(await collect('')).toEqual([])
    expect((await collect('a\n')).length).toBe(1)
  })
})
