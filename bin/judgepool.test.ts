import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { CSP, main, parseArgs, startServer } from './judgepool.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, 'judgepool.mjs')

interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

function get(port: number, path: string, method = 'GET'): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

let base: string
let site: string
let running: Awaited<ReturnType<typeof startServer>>

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'judgepool-test-'))
  site = join(base, 'site')
  mkdirSync(join(site, 'assets'), { recursive: true })
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>judgepool test</title>')
  writeFileSync(join(site, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(base, 'secret.txt'), 'TOP SECRET')
  symlinkSync(join(base, 'secret.txt'), join(site, 'link.txt'))
  running = await startServer({ dir: site, port: 0 })
})

afterAll(async () => {
  await running.close()
  rmSync(base, { recursive: true, force: true })
})

describe('static server', () => {
  test('listens on an ephemeral port when --port 0 is used', () => {
    expect(running.port).toBeGreaterThan(0)
  })

  test('/ is 200 HTML', async () => {
    const r = await get(running.port, '/')
    expect(r.status).toBe(200)
    expect(String(r.headers['content-type'])).toContain('text/html')
    expect(r.body).toContain('judgepool test')
  })

  test('serves assets with the right content type', async () => {
    const r = await get(running.port, '/assets/app.js')
    expect(r.status).toBe(200)
    expect(String(r.headers['content-type'])).toContain('javascript')
    expect(r.body).toBe('console.log(1)')
  })

  test('an unknown path falls back to index.html', async () => {
    const r = await get(running.port, '/no/such/page')
    expect(r.status).toBe(200)
    expect(r.body).toContain('judgepool test')
  })

  test('query strings are ignored', async () => {
    const r = await get(running.port, '/?lang=ko')
    expect(r.status).toBe(200)
    expect(r.body).toContain('judgepool test')
  })

  test.each(['/../package.json', '/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/bad%zz'])(
    'path escape %s is blocked',
    async (path) => {
      const r = await get(running.port, path)
      expect(r.status).toBe(403)
      expect(r.body).not.toContain('TOP SECRET')
      expect(r.body).not.toContain('"name": "judgepool"')
    },
  )

  test('a symlink pointing outside the folder is not followed', async () => {
    const r = await get(running.port, '/link.txt')
    expect(r.body).not.toContain('TOP SECRET')
    expect(r.body).toContain('judgepool test')
  })

  test("every response carries a CSP with connect-src 'none'", async () => {
    for (const path of ['/', '/assets/app.js', '/missing', '/../x']) {
      const r = await get(running.port, path)
      expect(String(r.headers['content-security-policy'])).toContain("connect-src 'none'")
    }
    expect(CSP).toContain("connect-src 'none'")
  })

  test('only GET and HEAD are allowed', async () => {
    expect((await get(running.port, '/', 'POST')).status).toBe(405)
    const head = await get(running.port, '/', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
  })

  test('binds to 127.0.0.1 by default', () => {
    const address = running.server.address()
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1')
  })
})

describe('argument parsing', () => {
  test('defaults', () => {
    expect(parseArgs([]).options).toMatchObject({ port: 5178, host: '127.0.0.1', help: false })
  })

  test('port, dir, host, lang, equals form', () => {
    const { options } = parseArgs(['--port', '0', '--dir', '/x', '--host=0.0.0.0', '--lang', 'ko'])
    expect(options).toMatchObject({ port: 0, dir: '/x', host: '0.0.0.0', lang: 'ko' })
  })

  test.each([
    [['--bogus'], 'err.unknown_option'],
    [['--port'], 'err.missing_value'],
    [['--port', 'abc'], 'err.bad_port'],
    [['--port', '70000'], 'err.bad_port'],
    [['--port', '-1'], 'err.bad_port'],
    [['--dir'], 'err.missing_value'],
    [['--lang', 'fr'], 'err.bad_lang'],
    [['--lang'], 'err.missing_value'],
    [['positional'], 'err.unknown_option'],
  ])('%j -> %s', (argv, key) => {
    expect(parseArgs(argv).error?.key).toBe(key)
  })
})

describe('--lang after an invalid option', () => {
  test.each([
    [['--port', 'abc', '--lang', 'en']],
    [['--port', 'abc', '--lang=en']],
    [['--bogus', '--lang', 'en']],
  ])('%j reports the error in English under LANG=ko_KR', async (argv) => {
    expect(parseArgs(argv).options.lang).toBe('en')
    const err: string[] = []
    const code = await main(argv, { LANG: 'ko_KR.UTF-8' }, { out: () => {}, err: (s: string) => err.push(s) })
    expect(code).toBe(2)
    expect(err.join('\n')).toMatch(/^(Invalid port|Unknown option)/)
  })

  test('invalid --lang value is ignored and keeps the original error', () => {
    const r = parseArgs(['--port', 'abc', '--lang', 'fr'])
    expect(r.error?.key).toBe('err.bad_port')
    expect(r.options.lang).toBeUndefined()
  })
})

describe('main()', () => {
  const capture = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } }
  }

  test('invalid arguments return exit code 2 and say what to do', async () => {
    const c = capture()
    expect(await main(['--port', 'abc'], {}, c.io)).toBe(2)
    expect(c.err[0]).toContain('abc')
  })

  test('a missing build folder returns 1 and mentions npm run build', async () => {
    const c = capture()
    expect(await main(['--dir', join(base, 'nope')], {}, c.io)).toBe(1)
    expect(c.err[0]).toContain('npm run build')
  })

  test('help text language follows --lang, then JUDGEPOOL_LANG, then LANG', async () => {
    const ko = capture()
    await main(['--help', '--lang', 'ko'], { LANG: 'en_US.UTF-8' }, ko.io)
    expect(ko.out[0]).toContain('사용법')
    const en = capture()
    await main(['--help', '--lang', 'en'], { LANG: 'ko_KR.UTF-8' }, en.io)
    expect(en.out[0]).toContain('Usage')
    const envKo = capture()
    await main(['--help'], { JUDGEPOOL_LANG: 'ko', LANG: 'en_US.UTF-8' }, envKo.io)
    expect(envKo.out[0]).toContain('사용법')
    const langKo = capture()
    await main(['--help'], { LANG: 'ko_KR.UTF-8' }, langKo.io)
    expect(langKo.out[0]).toContain('사용법')
  })
})

describe('the real executable', () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } })

  test('--help --lang ko prints Korean usage, --lang en prints English', () => {
    const ko = run(['--help', '--lang', 'ko'])
    expect(ko.status).toBe(0)
    expect(ko.stdout).toContain('사용법')
    const en = run(['--help', '--lang', 'en'])
    expect(en.stdout).toContain('Usage')
  })

  test('a bad argument exits with code 2', () => {
    const r = run(['--port', 'nope'])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('nope')
  })

  test('--version prints the package version', () => {
    expect(run(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('LANG=ko_KR.UTF-8 gives Korean when no flag is passed', () => {
    expect(run(['--help'], { LANG: 'ko_KR.UTF-8' }).stdout).toContain('사용법')
    expect(run(['--help'], { LANG: 'C' }).stdout).toContain('Usage')
  })
})

describe('packaging', () => {
  test('publishing builds the app first and ships dist', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'))
    expect(pkg.scripts.prepack).toBe('npm run build')
    expect(pkg.files).toContain('dist')
  })
})
