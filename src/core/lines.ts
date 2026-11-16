// Async line splitter that works on strings and byte streams.
// Handles chunk boundaries, CRLF and a leading BOM.

export interface SourceLine {
  /** 1-based line number. */
  no: number
  text: string
}

export type LineSource = string | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>

async function* chunks(source: LineSource): AsyncGenerator<Uint8Array | string> {
  if (typeof source === 'string') {
    yield source
    return
  }
  if ('getReader' in source) {
    // getReader works everywhere (async iteration of streams is not universal).
    const reader = source.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
  yield* source as AsyncIterable<Uint8Array | string>
}

export async function* splitLines(source: LineSource): AsyncGenerator<SourceLine> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let no = 0
  let first = true
  for await (const chunk of chunks(source)) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    if (first && buffer.length > 0) {
      if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1)
      first = false
    }
    let nl = buffer.indexOf('\n')
    while (nl >= 0) {
      let text = buffer.slice(0, nl)
      if (text.endsWith('\r')) text = text.slice(0, -1)
      no += 1
      yield { no, text }
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.length > 0) {
    if (first && buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1)
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1)
    no += 1
    yield { no, text: buffer }
  }
}
