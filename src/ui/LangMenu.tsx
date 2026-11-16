import { useLang } from '../i18n/context'
import { isLang } from '../i18n/i18n'

// Visible language choice. The value is saved by the provider (localStorage).
export function LangMenu() {
  const { lang, setLang, t } = useLang()
  return (
    <label className="lang-menu">
      <span>{t('lang.label')}</span>
      <select
        value={lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value)
        }}
      >
        <option value="en">English</option>
        <option value="ko">한국어</option>
      </select>
    </label>
  )
}
