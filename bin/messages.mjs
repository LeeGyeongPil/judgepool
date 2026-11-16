// CLI wording in English and Korean (same keys in both) and language choice.
// Priority: --lang > JUDGEPOOL_LANG > LC_ALL > LC_MESSAGES > LANG; anything that is not Korean is English.

export const CLI_MESSAGES = {
  en: {
    usage: [
      'Usage: judgepool [options]',
      '',
      'Serve the judgepool web app (pool retrieval runs, judge blind, compare systems).',
      'Everything runs in your browser; this command only serves the static files.',
      '',
      'Options:',
      '  --port <n>      port to listen on (default 5178, 0 = any free port)',
      '  --host <addr>   address to bind (default 127.0.0.1)',
      '  --dir <path>    folder with the built app (default: the packaged dist)',
      '  --lang <en|ko>  language of this help and messages (also JUDGEPOOL_LANG, LANG)',
      '  --version       print the version',
      '  --help          show this help',
    ].join('\n'),
    running: 'judgepool is running at {url}',
    stop: 'Press Ctrl+C to stop.',
    shutdown: 'Stopped.',
    'err.unknown_option': 'Unknown option: {option}. Run "judgepool --help" to see the options.',
    'err.missing_value': 'Option {option} needs a value. Example: {option} 5178',
    'err.bad_port': 'Invalid port "{value}". Use a whole number from 0 to 65535.',
    'err.bad_lang': 'Invalid language "{value}". Use en or ko.',
    'err.no_dir': 'Cannot find index.html in "{dir}". Build the app first with "npm run build", or pass --dir <folder>.',
    'err.port_in_use': 'Port {port} is already in use. Try another one, for example --port 0.',
    'err.listen': 'Could not start the server: {reason}',
  },
  ko: {
    usage: [
      '사용법: judgepool [옵션]',
      '',
      'judgepool 웹 앱(검색 결과 풀링, 블라인드 판정, 시스템 비교)을 띄웁니다.',
      '모든 처리는 브라우저에서 일어나고, 이 명령은 정적 파일만 제공합니다.',
      '',
      '옵션:',
      '  --port <n>      접속 포트 (기본 5178, 0 = 비어 있는 아무 포트)',
      '  --host <주소>   바인딩 주소 (기본 127.0.0.1)',
      '  --dir <경로>    빌드된 앱 폴더 (기본: 패키지에 든 dist)',
      '  --lang <en|ko>  도움말과 메시지 언어 (JUDGEPOOL_LANG, LANG 으로도 지정)',
      '  --version       버전 출력',
      '  --help          이 도움말 보기',
    ].join('\n'),
    running: 'judgepool 이 {url} 에서 실행 중입니다',
    stop: '멈추려면 Ctrl+C 를 누르세요.',
    shutdown: '종료했습니다.',
    'err.unknown_option': '알 수 없는 옵션: {option}. "judgepool --help" 로 옵션을 확인하세요.',
    'err.missing_value': '{option} 옵션에는 값이 필요합니다. 예: {option} 5178',
    'err.bad_port': '포트 "{value}" 가 올바르지 않습니다. 0에서 65535 사이의 정수를 쓰세요.',
    'err.bad_lang': '언어 "{value}" 가 올바르지 않습니다. en 또는 ko 를 쓰세요.',
    'err.no_dir': '"{dir}" 에서 index.html 을 찾을 수 없습니다. 먼저 "npm run build" 로 앱을 빌드하거나 --dir <폴더> 를 지정하세요.',
    'err.port_in_use': '포트 {port} 는 이미 사용 중입니다. 다른 포트를 쓰세요. 예: --port 0',
    'err.listen': '서버를 시작하지 못했습니다: {reason}',
  },
}

const isLang = (value) => value === 'en' || value === 'ko'

/** "ko_KR.UTF-8", "ko", "ko-KR" -> true */
const isKorean = (value) => typeof value === 'string' && /^ko([_.@-]|$)/i.test(value.trim())

/**
 * @param {{ flag?: string, env?: Record<string, string | undefined> }} input
 * @returns {'en' | 'ko'}
 */
export function detectCliLang({ flag, env = {} } = {}) {
  if (isLang(flag)) return flag
  if (isLang(env.JUDGEPOOL_LANG)) return env.JUDGEPOOL_LANG
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name]
    if (value !== undefined && value !== '') return isKorean(value) ? 'ko' : 'en'
  }
  return 'en'
}

export function t(lang, key, vars = {}) {
  const template = CLI_MESSAGES[lang]?.[key] ?? CLI_MESSAGES.en[key] ?? key
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}
