// Test-only helpers (this folder is excluded from the app build).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function fixture(name: string): string {
  return readFileSync(join(here, name), 'utf8')
}

export function exampleFile(name: string): string {
  return readFileSync(join(here, '..', '..', 'example', name), 'utf8')
}

export interface RefCase {
  name: string
  qrels: string
  run: string
  k: number
  trec: Record<string, number>
  common: Record<string, number>
  per_query: Record<string, Record<string, number>>
}

export function refCases(): RefCase[] {
  return (JSON.parse(fixture('ref.json')) as { cases: RefCase[] }).cases
}
