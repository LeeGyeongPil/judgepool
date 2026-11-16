// Regenerates the synthetic example in src/example/ (node scripts/make-example.mjs).
// Everything here is invented: a made-up notes app called "Lumen Notes", 36 help
// passages, 6 questions, 3 retrieval runs. The runs are written by hand-set rules
// so that a bm25-only pool favours bm25 while the full pool favours dense.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'example')
mkdirSync(out, { recursive: true })

// topic -> question, then six passages a..f with their grade (0-3).
const topics = [
  ['rec', 'How do I recover a deleted note?', [
    [3, 'Recover a deleted note: open Trash in the sidebar, select the note and press Restore. A deleted note stays in Trash for 30 days.'],
    [3, 'Removed something by accident? Everything you discard is kept in the bin for a month, and one tap puts it back in its notebook.'],
    [2, 'Version history keeps earlier copies of every page, so you can roll back to how it looked yesterday or last week.'],
    [1, 'Delete a note by swiping left on it in the list and tapping Delete. Notes in a shared notebook are removed for every member.'],
    [1, 'Emptying the Trash permanently deletes every deleted note and frees up storage. Notes cannot be recovered afterwards.'],
    [0, 'Note templates let you start a new note from a ready-made layout such as meeting minutes or a weekly plan.'],
  ]],
  ['off', 'Can I use Lumen Notes without an internet connection?', [
    [3, 'Offline mode: Lumen Notes works without an internet connection. Turn on Available offline for a notebook and edits sync when you reconnect.'],
    [3, 'No signal on a flight or in a tunnel? Pages you pinned to your device stay readable and editable, and changes upload once you are back online.'],
    [2, 'Sync status shows a small cloud icon; a crossed cloud means changes are waiting to be uploaded.'],
    [1, 'Connection problems: if Lumen Notes cannot connect to the server, check your network settings and try again.'],
    [1, 'Large attachments download on demand and are not stored on the device unless you pin them.'],
    [0, 'Keyboard shortcuts: press Ctrl+N for a new note, Ctrl+F to search, and Ctrl+P to print the current page.'],
  ]],
  ['shr', 'How can I share a notebook with a teammate?', [
    [3, "Share a notebook: open the notebook menu, choose Share, and enter a teammate's email address. They receive an invitation to join."],
    [3, "To let a colleague collaborate, send them an invite from the notebook's people panel and pick whether they can edit or only read."],
    [2, 'Permission levels: owners manage members, editors change pages, and viewers can only read and comment.'],
    [1, 'Sharing limits: a free workspace can share each notebook with up to five people.'],
    [1, 'Public links let anyone with the link read a page without signing in; turn a link off at any time.'],
    [0, 'Create a notebook from the plus button in the sidebar and pick a cover colour for it.'],
  ]],
  ['pdf', 'How do I export my notes to PDF?', [
    [3, 'Export a note to PDF: open the note menu, choose Export, select PDF and save the file to your computer.'],
    [3, 'Need a printable copy? Use the download option on a page and pick the portable document format, headings and images included.'],
    [2, 'Markdown export saves a note as a plain text file that other editors can open; images are saved in a folder next to it.'],
    [1, 'Export limits: exporting an entire notebook at once is available on paid plans and may take a few minutes.'],
    [0, 'Import notes from other apps by choosing Import in settings and selecting a file.'],
    [0, 'Page covers: add a banner image at the top of any page from the Cover button.'],
  ]],
  ['thm', 'How do I switch the app to dark mode?', [
    [3, 'Change the theme: open Settings, choose Appearance and select Dark, Light or System to switch the app to dark mode.'],
    [3, "Easier on the eyes at night: pick the dim colour scheme in display preferences, or let the app follow your phone's setting."],
    [2, 'Accent colours and font size can be changed in the same display preferences screen.'],
    [1, 'Theme gallery: browse notebook cover themes such as Paper, Forest and Sunset.'],
    [1, 'Change the app icon on iOS from Settings; a dark variant is included.'],
    [0, 'Spell check works in over forty languages and can be turned off for a notebook.'],
  ]],
  ['pwd', 'How do I reset my password?', [
    [3, 'Reset your password: on the sign-in screen choose Forgot password, enter your email and follow the link we send you.'],
    [3, 'Locked out of your account? Ask for a recovery message on the login page and set a new secret from the link inside.'],
    [2, 'Two-step verification protects your account; keep your backup codes somewhere safe in case you lose your phone.'],
    [1, 'Change your password any time from Account settings; use at least twelve characters for a strong password.'],
    [0, 'Sign in with Google or Apple instead of creating a password, from the sign-in screen.'],
    [0, 'Delete your account from Account settings; all notebooks are removed after a 14-day grace period.'],
  ]],
]
const letters = ['a', 'b', 'c', 'd', 'e', 'f']

const docText = new Map()
const grade = new Map() // `${qid}\t${docId}` -> grade
topics.forEach(([prefix, , passages], ti) => {
  passages.forEach(([g, text], li) => {
    const id = `${prefix}-${letters[li]}`
    docText.set(id, text)
    grade.set(`q${ti + 1}\t${id}`, g)
  })
})
// A re-chunked copy of rec-a: identical text, different doc id (used by the dense run).
docText.set('rec-a2', docText.get('rec-a'))
grade.set('q1\trec-a2', 3)

const name = (ti, letter) => `${topics[ti][0]}-${letter}`
const others = (ti) => topics.map((_, i) => i).filter((i) => i !== ti)

const runs = { bm25: [], dense: [], hybrid: [] }
topics.forEach((_, ti) => {
  const qid = `q${ti + 1}`
  const [o1, o2, o3, o4, o5] = others(ti)
  const bm25 = [name(ti, 'a'), name(ti, 'd'), name(ti, 'e'), name(ti, 'f'), name(o1, 'd'), name(o2, 'd'), name(o3, 'd'), name(o4, 'd'), name(o5, 'd'), name(o1, 'f')]
  if (ti === 2) {
    bm25.splice(4, 0, name(ti, 'b'))
    bm25.pop()
  }
  if (ti === 4) {
    bm25.splice(5, 0, name(ti, 'c'))
    bm25.pop()
  }
  let dense = [name(ti, 'b'), name(ti, 'a'), name(ti, 'c'), name(ti, 'e'), name(o1, 'b'), name(o2, 'b'), name(o3, 'b'), name(o4, 'b'), name(o5, 'b'), name(ti, 'f')]
  if (ti === 0) dense[1] = 'rec-a2'
  if (ti === 3) dense = [name(ti, 'b'), name(ti, 'd'), name(ti, 'a'), name(ti, 'c'), name(o1, 'b'), name(o2, 'b'), name(o3, 'b'), name(o4, 'b'), name(o5, 'b'), name(ti, 'e')]
  const hybrid = [name(ti, 'a'), name(ti, 'b'), name(ti, 'd'), name(ti, 'c'), name(ti, 'e'), name(o1, 'b'), name(o2, 'b'), name(o1, 'd'), name(o2, 'd'), name(ti, 'f')]
  bm25.forEach((d, r) => {
    // q1: rec-a and rec-d share a score on purpose (trec_eval breaks ties by doc id, descending).
    const score = ti === 0 && r === 1 ? 12.0 : (12 - 0.7 * r).toFixed(1)
    runs.bm25.push(`${qid} Q0 ${d} ${r + 1} ${Number(score).toFixed(1)} bm25`)
  })
  dense.forEach((d, r) => runs.dense.push(`${qid} Q0 ${d} ${r + 1} ${(0.92 - 0.03 * r).toFixed(2)} dense`))
  hybrid.forEach((d, r) => runs.hybrid.push(`${qid} Q0 ${d} ${r + 1} ${(0.9 - 0.05 * r).toFixed(2)} hybrid`))
})

writeFileSync(join(out, 'queries.jsonl'), topics.map(([, q], i) => JSON.stringify({ _id: `q${i + 1}`, text: q })).join('\n') + '\n')
writeFileSync(
  join(out, 'corpus.jsonl'),
  [...docText].map(([id, text]) => JSON.stringify({ _id: id, title: '', text })).join('\n') + '\n',
)
for (const [runName, lines] of Object.entries(runs)) writeFileSync(join(out, `${runName}.run`), lines.join('\n') + '\n')

// Example judgments: every doc that appears in any run's top 10, default grade 0.
const judgments = []
const seen = new Set()
for (const lines of Object.values(runs)) {
  for (const line of lines) {
    const [qid, , docId] = line.split(' ')
    const key = `${qid}\t${docId}`
    if (seen.has(key)) continue
    seen.add(key)
    judgments.push({ query_id: qid, doc_id: docId, grade: grade.get(key) ?? 0 })
  }
}
judgments.sort((a, b) => (a.query_id === b.query_id ? (a.doc_id < b.doc_id ? -1 : 1) : a.query_id < b.query_id ? -1 : 1))
writeFileSync(join(out, 'judgments.jsonl'), judgments.map((j) => JSON.stringify(j)).join('\n') + '\n')
console.log(`corpus ${docText.size} docs, ${topics.length} queries, ${judgments.length} example judgments`)
