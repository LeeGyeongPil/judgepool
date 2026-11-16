import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_POOL_CONFIG } from './core/pool'
import {
  addRun,
  applyGrades,
  progress,
  createSession,
  extendSession,
  mergeDocs,
  setContribute,
} from './core/session'
import type { Doc, NamedRun, ParseIssue, PoolConfig, Qrels, SessionState } from './core/types'
import { loadExample, type ExampleData } from './example'
import { useLang } from './i18n/context'
import { IdbStore } from './store/idb'
import { DEFAULT_SESSION_ID } from './store/store'
import { ExportPanel } from './ui/ExportPanel'
import { JudgeView } from './ui/JudgeView'
import { LangMenu } from './ui/LangMenu'
import { LoadPanel, type FileNote } from './ui/LoadPanel'
import { ResultsTable } from './ui/ResultsTable'
import { readInputFile, type Loaded } from './ui/ingest'

type Tab = 'load' | 'judge' | 'compare' | 'export'

interface Staged {
  runs: NamedRun[]
  queries: Map<string, string>
  baseQrels: Qrels
  config: PoolConfig
  seed: string
  judge: string
}

const emptyStaged = (): Staged => ({
  runs: [],
  queries: new Map(),
  baseQrels: new Map(),
  config: { ...DEFAULT_POOL_CONFIG },
  seed: 'judgepool',
  judge: 'me',
})

const store = new IdbStore()
const MAX_DEPTH = 100

export function App() {
  const { t } = useLang()
  const [tab, setTab] = useState<Tab>('load')
  const [session, setSession] = useState<SessionState | null>(null)
  const [staged, setStaged] = useState<Staged>(emptyStaged)
  const [docs, setDocs] = useState<Map<string, Doc>>(new Map())
  const [notes, setNotes] = useState<FileNote[]>([])
  const [example, setExample] = useState<ExampleData | null>(null)
  const [resumable, setResumable] = useState<SessionState | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const noteId = useRef(0)

  // Offer to continue a saved session (first render only).
  useEffect(() => {
    store
      .load(DEFAULT_SESSION_ID)
      .then((found) => {
        if (found && found.items.length > 0) setResumable(found)
      })
      .catch(() => setSaveFailed(true))
  }, [])

  // Autosave after every change (small delay merges bursts of key presses).
  useEffect(() => {
    if (!session) return
    const timer = window.setTimeout(() => {
      store.save(DEFAULT_SESSION_ID, session).then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      )
    }, 250)
    return () => window.clearTimeout(timer)
  }, [session])

  const addNote = useCallback((fileName: string, loaded: Loaded) => {
    noteId.current += 1
    const issues: ParseIssue[] = loaded.issues
    setNotes((prev) => [...prev, { id: noteId.current, fileName, kind: loaded.kind, count: loaded.count, issues }])
  }, [])

  const onFiles = useCallback(
    async (files: File[]) => {
      setBusy(true)
      try {
        for (const file of files) {
          let loaded: Loaded
          try {
            loaded = await readInputFile(file, MAX_DEPTH)
          } catch {
            addNote(file.name, { kind: 'unknown', issues: [{ line: 1, code: 'file.read' }], count: 0 })
            continue
          }
          addNote(file.name, loaded)
          if (loaded.kind === 'run') {
            const run: NamedRun = { name: loaded.name, contribute: true, entries: loaded.entries }
            if (session) setSession((s) => (s ? addRun(s, { ...run, contribute: false }, docs) : s))
            else setStaged((s) => ({ ...s, runs: [...s.runs.filter((r) => r.name !== run.name), run] }))
          } else if (loaded.kind === 'queries') {
            if (session) setSession((s) => (s ? extendSession({ ...s, queries: new Map([...s.queries, ...loaded.queries]) }) : s))
            else setStaged((s) => ({ ...s, queries: new Map([...s.queries, ...loaded.queries]) }))
          } else if (loaded.kind === 'corpus') {
            setDocs((d) => new Map([...d, ...loaded.docs]))
            setSession((s) => (s ? mergeDocs(s, loaded.docs) : s))
          } else if (loaded.kind === 'qrels') {
            if (session) setSession((s) => (s ? { ...s, baseQrels: mergeQrels(s.baseQrels, loaded.qrels) } : s))
            else setStaged((s) => ({ ...s, baseQrels: mergeQrels(s.baseQrels, loaded.qrels) }))
          } else if (loaded.kind === 'backup' && loaded.state) {
            setSession(loaded.state)
            setDocs(loaded.state.docs)
            setTab('judge')
          }
        }
      } finally {
        setBusy(false)
      }
    },
    [addNote, docs, session],
  )

  const buildPool = useCallback((config: PoolConfig) => {
    setSession(
      createSession({
        judge: staged.judge,
        seed: staged.seed,
        config,
        runs: staged.runs,
        queries: staged.queries,
        docs,
        baseQrels: staged.baseQrels,
      }),
    )
    setTab('judge')
  }, [docs, staged])

  const onExample = useCallback(async () => {
    const data = await loadExample()
    setExample(data)
    setDocs(data.docs)
    setNotes([])
    setStaged(emptyStaged())
    setSession(
      createSession({ config: { ...DEFAULT_POOL_CONFIG }, runs: data.runs, queries: data.queries, docs: data.docs }),
    )
    setTab('load')
  }, [])

  const toggleContribute = useCallback((name: string, on: boolean) => {
    if (session) setSession((s) => (s ? extendSession(setContribute(s, name, on)) : s))
    else setStaged((s) => ({ ...s, runs: s.runs.map((r) => (r.name === name ? { ...r, contribute: on } : r)) }))
  }, [session])

  const applyPoolConfig = useCallback((config: PoolConfig) => {
    if (session) setSession((s) => (s ? extendSession(s, config) : s))
    else setStaged((s) => ({ ...s, config }))
  }, [session])

  const fillExample = useCallback(() => {
    if (example) setSession((s) => (s ? applyGrades(s, example.grades) : s))
  }, [example])

  const reset = useCallback(() => {
    setSession(null)
    setStaged(emptyStaged())
    setNotes([])
    setExample(null)
    store.remove(DEFAULT_SESSION_ID).catch(() => setSaveFailed(true))
    setTab('load')
  }, [])

  const pending = session ? progress(session).pending : 0

  return (
    <div className="app">
      <header className="top">
        <h1>judgepool</h1>
        <p className="tagline">{t('app.tagline')}</p>
        <LangMenu />
      </header>

      {saveFailed && <div className="banner warn">{t('save.failed')}</div>}

      {resumable && !session && (
        <div className="banner">
          <span>{t('resume.found', { judged: resumable.judgments.size, total: resumable.items.length })}</span>
          <button
            onClick={() => {
              setSession(resumable)
              setDocs(resumable.docs)
              setResumable(null)
              setTab('judge')
            }}
          >
            {t('resume.continue')}
          </button>
          <button
            onClick={() => {
              setResumable(null)
              store.remove(DEFAULT_SESSION_ID).catch(() => setSaveFailed(true))
            }}
          >
            {t('resume.discard')}
          </button>
        </div>
      )}

      <nav className="tabs" aria-label={t('nav.label')}>
        {(['load', 'judge', 'compare', 'export'] as Tab[]).map((id) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} disabled={id !== 'load' && !session}>
            {t(`tab.${id}`)}
            {id === 'judge' && session ? ` (${pending})` : ''}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'load' && (
          <LoadPanel
            busy={busy}
            notes={notes}
            runs={session ? session.runs : staged.runs}
            config={session ? session.config : staged.config}
            seed={session ? session.seed : staged.seed}
            judgeName={session ? session.judge : staged.judge}
            hasSession={session !== null}
            canFillExample={example !== null && session !== null}
            onFiles={onFiles}
            onExample={onExample}
            onToggle={toggleContribute}
            onApplyConfig={applyPoolConfig}
            onSeed={(seed) => setStaged((s) => ({ ...s, seed }))}
            onJudgeName={(judge) => {
              if (session) setSession((s) => (s ? { ...s, judge } : s))
              else setStaged((s) => ({ ...s, judge }))
            }}
            onBuild={buildPool}
            onFillExample={fillExample}
            onReset={reset}
            queryCount={session ? session.queries.size : staged.queries.size}
            poolSize={session ? session.items.length : 0}
            pending={pending}
          />
        )}
        {tab === 'judge' && session && <JudgeView session={session} onChange={setSession} />}
        {tab === 'compare' && session && <ResultsTable session={session} />}
        {tab === 'export' && session && <ExportPanel session={session} />}
      </main>
    </div>
  )
}

function mergeQrels(a: Qrels, b: Qrels): Qrels {
  const out: Qrels = new Map()
  for (const source of [a, b]) {
    for (const [qid, docs] of source) {
      const inner = out.get(qid) ?? new Map<string, number>()
      for (const [d, rel] of docs) inner.set(d, rel)
      out.set(qid, inner)
    }
  }
  return out
}
