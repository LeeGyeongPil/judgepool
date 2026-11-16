import { useMemo, useState } from 'react'
import { compareRuns } from '../core/compare'
import type { Averaging } from '../core/metrics'
import { judgmentsToQrels } from '../core/session'
import type { SessionState } from '../core/types'
import { useLang } from '../i18n/context'

const fmt = (x: number) => x.toFixed(4)

export function ResultsTable({ session }: { session: SessionState }) {
  const { t } = useLang()
  const [k, setK] = useState(10)
  const [minRel, setMinRel] = useState(1)
  const [averaging, setAveraging] = useState<Averaging>('common')
  const [threshold, setThreshold] = useState(0.9)

  const comparison = useMemo(
    () =>
      compareRuns(session.runs, judgmentsToQrels(session), {
        k,
        minRel,
        averaging,
        judgedThreshold: threshold,
        poolDepth: session.config.depth,
      }),
    [session, k, minRel, averaging, threshold],
  )
  const best = Math.max(...comparison.rows.map((r) => r.mean.ndcg), 0)
  const warned = comparison.rows.filter((r) => r.biasWarning)

  return (
    <section>
      <div className="row">
        <label>
          {t('cmp.k')}{' '}
          <select value={k} onChange={(e) => setK(Number(e.target.value))}>
            {[1, 3, 5, 10, 20].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('cmp.minrel')}{' '}
          <select value={minRel} onChange={(e) => setMinRel(Number(e.target.value))}>
            <option value={1}>{t('cmp.minrel.1')}</option>
            <option value={2}>{t('cmp.minrel.2')}</option>
          </select>
        </label>
        <label>
          {t('cmp.avg')}{' '}
          <select value={averaging} onChange={(e) => setAveraging(e.target.value as Averaging)}>
            <option value="common">{t('cmp.avg.common')}</option>
            <option value="trec">{t('cmp.avg.trec')}</option>
          </select>
        </label>
        <label>
          {t('cmp.threshold')}{' '}
          <input type="number" min={0} max={1} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 70 }} />
        </label>
      </div>

      <table className="results">
        <thead>
          <tr>
            <th>{t('cmp.system')}</th>
            <th>nDCG@{k}</th>
            <th>Recall@{k}</th>
            <th>P@{k}</th>
            <th>MRR</th>
            <th>judged@{k}</th>
            <th>{t('cmp.queries')}</th>
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((r) => (
            <tr key={r.name} className={r.biasWarning ? 'warn-row' : ''}>
              <td>
                {r.name}
                {!r.contribute && <span className="tag"> {t('cmp.evalonly')}</span>}
              </td>
              <td className={r.mean.ndcg === best && best > 0 ? 'best' : ''}>{fmt(r.mean.ndcg)}</td>
              <td>{fmt(r.mean.recall)}</td>
              <td>{fmt(r.mean.precision)}</td>
              <td>{fmt(r.mean.rr)}</td>
              <td>
                {fmt(r.mean.judged)}
                {r.biasWarning && <span className="warn-text" title={t('cmp.warn.tip')}> ⚠</span>}
              </td>
              <td>
                {r.queries}
                {r.missing > 0 && <span className="hint"> ({t('cmp.missing', { count: r.missing })})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {warned.length > 0 && (
        <div className="banner warn">
          {t('cmp.warn', { systems: warned.map((r) => r.name).join(', '), threshold: threshold })}
        </div>
      )}
      {comparison.kExceedsPoolDepth && <div className="banner">{t('cmp.kdepth', { k, depth: session.config.depth })}</div>}
      {comparison.rows.every((r) => r.queries === 0) && <p className="hint">{t('cmp.nojudgments')}</p>}
      <p className="hint">{t('cmp.note')}</p>
    </section>
  )
}
