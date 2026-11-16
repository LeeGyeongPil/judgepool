import { useRef, useState, type DragEvent } from 'react'
import type { NamedRun, ParseIssue, PoolConfig } from '../core/types'
import { useLang } from '../i18n/context'

export interface FileNote {
  id: number
  fileName: string
  kind: string
  count: number
  issues: ParseIssue[]
}

interface Props {
  busy: boolean
  notes: FileNote[]
  runs: NamedRun[]
  config: PoolConfig
  seed: string
  judgeName: string
  hasSession: boolean
  canFillExample: boolean
  queryCount: number
  poolSize: number
  pending: number
  onFiles: (files: File[]) => void
  onExample: () => void
  onToggle: (name: string, on: boolean) => void
  onApplyConfig: (config: PoolConfig) => void
  onSeed: (seed: string) => void
  onJudgeName: (name: string) => void
  onBuild: (config: PoolConfig) => void
  onFillExample: () => void
  onReset: () => void
}

export function LoadPanel(p: Props) {
  const { t } = useLang()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [depth, setDepth] = useState(String(p.config.depth))
  const [dedupe, setDedupe] = useState(p.config.dedupeByText)

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    p.onFiles([...e.dataTransfer.files])
  }

  const depthValue = Number.parseInt(depth, 10)
  const depthOk = Number.isInteger(depthValue) && depthValue >= 1 && depthValue <= 100

  return (
    <section>
      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') input.current?.click()
        }}
      >
        <strong>{t('load.drop')}</strong>
        <p>{t('load.formats')}</p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            p.onFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      <div className="row">
        <button onClick={p.onExample}>{t('load.example')}</button>
        <span className="hint">{t('load.example.note')}</span>
      </div>
      {p.busy && <p className="hint">{t('load.reading')}</p>}

      {p.notes.length > 0 && (
        <ul className="notes">
          {p.notes.map((n) => (
            <li key={n.id}>
              <code>{n.fileName}</code> — {t(`kind.${n.kind}`)}, {t('load.count', { count: n.count })}
              {n.issues.length > 0 && (
                <details>
                  <summary className="warn-text">{t('load.issues', { count: n.issues.length })}</summary>
                  <ul>
                    {n.issues.slice(0, 20).map((issue, i) => (
                      <li key={i}>
                        {t('load.line', { line: issue.line })}: {t(`issue.${issue.code}`, issue.vars)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>{t('runs.title')}</h2>
      {p.runs.length === 0 ? (
        <p className="hint">{t('runs.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('runs.name')}</th>
              <th>{t('runs.queries')}</th>
              <th>{t('runs.contribute')}</th>
            </tr>
          </thead>
          <tbody>
            {p.runs.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.entries.size}</td>
                <td>
                  <label>
                    <input type="checkbox" checked={r.contribute} onChange={(e) => p.onToggle(r.name, e.target.checked)} />{' '}
                    {r.contribute ? t('runs.contribute.on') : t('runs.contribute.off')}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">{t('runs.help')}</p>

      <h2>{t('pool.title')}</h2>
      <div className="row">
        <label>
          {t('pool.depth')}{' '}
          <input type="number" min={1} max={100} value={depth} onChange={(e) => setDepth(e.target.value)} style={{ width: 70 }} />
        </label>
        <label>
          <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> {t('pool.dedupe')}
        </label>
        <label>
          {t('pool.seed')}{' '}
          <input value={p.seed} disabled={p.hasSession} onChange={(e) => p.onSeed(e.target.value)} style={{ width: 120 }} />
        </label>
        <label>
          {t('pool.judge')} <input value={p.judgeName} onChange={(e) => p.onJudgeName(e.target.value)} style={{ width: 100 }} />
        </label>
      </div>
      {!depthOk && <p className="warn-text">{t('pool.depth.invalid')}</p>}
      <div className="row">
        {p.hasSession ? (
          <button disabled={!depthOk} onClick={() => p.onApplyConfig({ depth: depthValue, dedupeByText: dedupe })}>
            {t('pool.apply')}
          </button>
        ) : (
          <button
            className="primary"
            disabled={!depthOk || p.runs.every((r) => !r.contribute) || p.queryCount === 0}
            onClick={() => p.onBuild({ depth: depthValue, dedupeByText: dedupe })}
          >
            {t('pool.build')}
          </button>
        )}
        {p.canFillExample && <button onClick={p.onFillExample}>{t('example.fill')}</button>}
        {p.hasSession && <button onClick={p.onReset}>{t('session.reset')}</button>}
      </div>
      {p.hasSession && (
        <p>{t('pool.summary', { queries: p.queryCount, items: p.poolSize, pending: p.pending })}</p>
      )}
      {!p.hasSession && p.queryCount === 0 && p.runs.length > 0 && <p className="hint">{t('pool.needs.queries')}</p>}
      <p className="hint">{t('privacy.note')}</p>
    </section>
  )
}
