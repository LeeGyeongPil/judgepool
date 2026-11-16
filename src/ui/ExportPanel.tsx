import { useMemo, useState } from 'react'
import { exportBeirTsv, exportTrecQrels, writeBackup } from '../core/export'
import type { SessionState } from '../core/types'
import { useLang } from '../i18n/context'

type Format = 'trec' | 'beir' | 'backup'

const FILES: Record<Format, { name: string; mime: string }> = {
  trec: { name: 'qrels.txt', mime: 'text/plain' },
  beir: { name: 'qrels.tsv', mime: 'text/tab-separated-values' },
  backup: { name: 'judgepool-backup.jsonl', mime: 'application/x-ndjson' },
}

export function ExportPanel({ session }: { session: SessionState }) {
  const { t } = useLang()
  const [format, setFormat] = useState<Format>('trec')
  const text = useMemo(() => {
    if (format === 'trec') return exportTrecQrels(session)
    if (format === 'beir') return exportBeirTsv(session)
    return writeBackup(session)
  }, [format, session])

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: FILES[format].mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = FILES[format].name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section>
      <div className="row">
        {(['trec', 'beir', 'backup'] as Format[]).map((f) => (
          <label key={f}>
            <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} /> {t(`export.${f}`)}
          </label>
        ))}
      </div>
      <p className="hint">{t(`export.${format}.help`)}</p>
      <textarea readOnly value={text.slice(0, 6000)} rows={14} className="preview" aria-label={t('export.preview')} />
      {text.length > 6000 && <p className="hint">{t('export.truncated')}</p>}
      <div className="row">
        <button className="primary" onClick={download} disabled={text === ''}>
          {t('export.download', { file: FILES[format].name })}
        </button>
      </div>
      {text === '' && <p className="hint">{t('export.empty')}</p>}
      <p className="hint">{t('export.backup.advice')}</p>
    </section>
  )
}
