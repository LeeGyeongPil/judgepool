// Text normalisation and a small synchronous hash, used to group passages
// whose text is identical (for example the same chunk under two doc ids).

/** NFKC, lower-case, collapse whitespace. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

const MASK64 = (1n << 64n) - 1n
const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

/** FNV-1a 64-bit over UTF-16 code units, as 16 hex digits. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK64
  }
  return hash.toString(16).padStart(16, '0')
}

/** FNV-1a 32-bit (unsigned). */
export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function textKey(text: string): string {
  return fnv1a64(normalizeText(text))
}
