import { useEffect, useState } from 'react'
import { currentItem, goTo, judge, move, progress, skip, undo } from '../core/session'
import { toBlindItem } from '../core/shuffle'
import type { Grade, SessionState } from '../core/types'
import { useLang } from '../i18n/context'

interface Props {
  session: SessionState
  onChange: (next: SessionState) => void
}

const GRADES: Grade[] = [0, 1, 2, 3]

export function JudgeView({ session, onChange }: Props) {
  const { t } = useLang()
  const [help, setHelp] = useState(false)
  const item = currentItem(session)
  const prog = progress(session)
  const entry = item ? session.judgments.get(item.id) : undefined

  // Keyboard: 0-3 grade, S skip, U undo, arrows move, ? help.
  // Ignored while typing in a field or composing text with an IME.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key >= '0' && e.key <= '3') onChange(judge(session, Number(e.key) as Grade))
      else if (e.key === 's' || e.key === 'S') onChange(skip(session))
      else if (e.key === 'u' || e.key === 'U') onChange(undo(session))
      else if (e.key === 'ArrowRight') onChange(move(session, 1))
      else if (e.key === 'ArrowLeft') onChange(move(session, -1))
      else if (e.key === '?') setHelp((h) => !h)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, onChange])

  if (!item) return <p>{t('judge.empty')}</p>
  const blind = toBlindItem(item, session.queries)
  const done = prog.judged + prog.skipped
  const q = prog.perQuery.get(item.qid)

  return (
    <section>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={done}>
        <div style={{ width: `${prog.total ? (100 * done) / prog.total : 0}%` }} />
      </div>
      <p className="hint">
        {t('judge.progress', { done, total: prog.total, judged: prog.judged, skipped: prog.skipped })}
        {q ? ` · ${t('judge.progress.query', { done: q.done, total: q.total })}` : ''}
      </p>

      <div className="card">
        <p className="label">{t('judge.query')}</p>
        <p className="query">{blind.queryText}</p>
        <p className="label">{t('judge.passage')}</p>
        {blind.title && <p className="title">{blind.title}</p>}
        <p className="passage">{blind.text || t('judge.nopassage')}</p>
        <p className="hint">
          {t('judge.position', { n: session.cursor + 1, total: session.order.length })}
          {entry?.kind === 'grade' && ` · ${t('judge.current', { grade: entry.grade })}`}
          {entry?.kind === 'skip' && ` · ${t('judge.skipped')}`}
        </p>
      </div>

      <div className="grades">
        {GRADES.map((g) => (
          <button
            key={g}
            className={entry?.kind === 'grade' && entry.grade === g ? 'active' : ''}
            onClick={() => onChange(judge(session, g))}
          >
            <kbd>{g}</kbd> {t(`grade.${g}`)}
          </button>
        ))}
      </div>
      <div className="row">
        <button onClick={() => onChange(skip(session))}>
          <kbd>S</kbd> {t('judge.skip')}
        </button>
        <button onClick={() => onChange(undo(session))} disabled={session.history.length === 0}>
          <kbd>U</kbd> {t('judge.undo')}
        </button>
        <button onClick={() => onChange(goTo(session, session.cursor - 1))}>
          <kbd>←</kbd> {t('judge.prev')}
        </button>
        <button onClick={() => onChange(goTo(session, session.cursor + 1))}>
          {t('judge.next')} <kbd>→</kbd>
        </button>
        <button onClick={() => setHelp((h) => !h)}>
          <kbd>?</kbd> {t('judge.help')}
        </button>
      </div>
      {help && (
        <div className="help">
          <h3>{t('judge.help.title')}</h3>
          <ul>
            <li>{t('judge.help.grades')}</li>
            <li>{t('judge.help.skip')}</li>
            <li>{t('judge.help.move')}</li>
            <li>{t('judge.help.blind')}</li>
            <li>{t('judge.help.save')}</li>
          </ul>
        </div>
      )}
      {prog.pending === 0 && <p className="ok-text">{t('judge.alldone')}</p>}
    </section>
  )
}
