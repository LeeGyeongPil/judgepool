#!/usr/bin/env node
// judgepool launcher: a tiny static file server for the built web app.
// Node built-ins only. Binds to 127.0.0.1 by default and tells the browser
// (Content-Security-Policy) that the page may not talk to any network.

import { createServer } from 'node:http'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectCliLang, t } from './messages.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PORT = 5178

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

// connect-src 'none': fetch, XHR, WebSocket and beacons are all blocked, so the
// data you load cannot leave the page even if a dependency tried to send it.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** Find a valid `--lang en|ko` / `--lang=en|ko` anywhere in argv (last one wins); other values are ignored. */
function scanLang(argv) {
  let found
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i] === '--lang' ? argv[i + 1] : argv[i].startsWith('--lang=') ? argv[i].slice(7) : undefined
    if (v === 'en' || v === 'ko') found = v
  }
  return found
}

/** Parse argv. Returns { options } or { error: { key, vars } }; never exits. */
export function parseArgs(argv) {
  const result = parseArgsInner(argv)
  // On an early error the rest of argv was not read; still honour --lang so the message uses it.
  if (result.error && result.options.lang === undefined) result.options.lang = scanLang(argv)
  return result
}

function parseArgsInner(argv) {
  const options = { port: DEFAULT_PORT, host: '127.0.0.1', dir: undefined, lang: undefined, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = () => {
      if (inline !== undefined) return inline
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) return undefined
      i += 1
      return next
    }
    switch (name) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--version':
      case '-v':
        options.version = true
        break
      case '--port': {
        const v = value()
        if (v === undefined) return { error: { key: 'err.missing_value', vars: { option: '--port' } }, options }
        if (!/^\d+$/.test(v) || Number(v) > 65535) return { error: { key: 'err.bad_port', vars: { value: v } }, options }
        options.port = Number(v)
        break
      }
      case '--host': {
        const v = value()
        if (v === undefined) return { error: { key: 'err.missing_value', vars: { option: '--host' } }, options }
        options.host = v
        break
      }
      case '--dir': {
        const v = value()
        if (v === undefined) return { error: { key: 'err.missing_value', vars: { option: '--dir' } }, options }
        options.dir = v
        break
      }
      case '--lang': {
        const v = value()
        if (v === undefined) return { error: { key: 'err.missing_value', vars: { option: '--lang' } }, options }
        if (v !== 'en' && v !== 'ko') return { error: { key: 'err.bad_lang', vars: { value: v } }, options }
        options.lang = v
        break
      }
      default:
        return { error: { key: 'err.unknown_option', vars: { option: arg } }, options }
    }
  }
  return { options }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
    ...headers,
  })
  res.end(body)
}

/** Reject any request whose path tries to climb out of the folder. */
function hasTraversal(rawPath) {
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return true
  }
  if (decoded.includes('\0')) return true
  return rawPath.split('/').concat(decoded.split(/[\\/]/)).some((segment) => segment === '..')
}

/**
 * Start serving `dir`. Resolves with { server, port, close() }.
 * @param {{ dir: string, host?: string, port?: number }} config
 */
export async function startServer({ dir, host = '127.0.0.1', port = DEFAULT_PORT }) {
  const root = await realpath(resolve(dir))
  const index = join(root, 'index.html')

  async function serveFile(req, res, file) {
    const body = await readFile(file)
    send(res, 200, req.method === 'HEAD' ? undefined : body, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
    })
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      const rawPath = (req.url ?? '/').split(/[?#]/)[0]
      if (hasTraversal(rawPath)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' })
        return
      }
      const relative = decodeURIComponent(rawPath).replace(/^\/+/, '')
      const candidate = resolve(root, relative === '' ? 'index.html' : relative)
      let target = index
      if (candidate === root || candidate.startsWith(root + sep)) {
        try {
          const real = await realpath(candidate)
          if ((real.startsWith(root + sep)) && (await stat(real)).isFile()) target = real
        } catch {
          // not found: fall back to index.html (single-page app)
        }
      }
      await serveFile(req, res, target)
    } catch {
      send(res, 500, 'Internal Server Error', { 'Content-Type': 'text/plain; charset=utf-8' })
    }
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      server.off('error', rejectListen)
      resolveListen(undefined)
    })
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return {
    server,
    port: actualPort,
    close: () =>
      new Promise((done) => {
        server.close(() => done(undefined))
        server.closeAllConnections?.()
      }),
  }
}

/** The CLI. Returns an exit code (the caller decides whether to exit). */
export async function main(argv, env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const parsed = parseArgs(argv)
  const lang = detectCliLang({ flag: parsed.options.lang, env })
  if (parsed.error) {
    io.err(t(lang, parsed.error.key, parsed.error.vars))
    return 2
  }
  const { options } = parsed
  if (options.help) {
    io.out(t(lang, 'usage'))
    return 0
  }
  if (options.version) {
    io.out(JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version)
    return 0
  }
  const dir = resolve(options.dir ?? join(here, '..', 'dist'))
  if (!existsSync(join(dir, 'index.html'))) {
    io.err(t(lang, 'err.no_dir', { dir }))
    return 1
  }
  let running
  try {
    running = await startServer({ dir, host: options.host, port: options.port })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    io.err(code === 'EADDRINUSE' ? t(lang, 'err.port_in_use', { port: options.port }) : t(lang, 'err.listen', { reason: String(error?.message ?? error) }))
    return 1
  }
  const shownHost = options.host.includes(':') ? `[${options.host}]` : options.host
  io.out(t(lang, 'running', { url: `http://${shownHost}:${running.port}` }))
  io.out(t(lang, 'stop'))
  const stop = async () => {
    await running.close()
    io.out(t(lang, 'shutdown'))
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return undefined
}

// Run only when executed directly (also through the npx/npm bin symlink).
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : ''
if (invoked === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== undefined) process.exitCode = code
  })
}
