/** Structured equipment codes: `{D}-{CAT}-{BRAND}-{MODEL}` on the list row, `…-{NNN}` per unit. */

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

function isConsonant(ch: string): boolean {
  const c = ch.toUpperCase();
  return c >= 'A' && c <= 'Z' && !VOWELS.has(c);
}

function letters(word: string): string {
  return word.toUpperCase().replace(/[^A-Z]/g, '');
}

function consonants(word: string): string {
  return [...letters(word)].filter(isConsonant).join('');
}

function padX(value: string, length: number): string {
  const s = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length >= length) return s.slice(0, length);
  return s.padEnd(length, 'X');
}

/** Split on spaces and slashes. `&` / standalone "and" become the word AND. */
export function splitNameWords(name: string): string[] {
  const normalized = name.trim().replace(/&/g, ' AND ');
  return normalized.split(/[\s/]+/).filter(Boolean);
}

function firstLetter(word: string): string {
  return letters(word)[0] || 'X';
}

export function departmentLetter(departmentName: string | null | undefined): string {
  return (departmentName || '').trim() === 'Camera' ? 'C' : 'L';
}

export function abbreviateCategory(name: string | null | undefined): string {
  const words = splitNameWords(name || '');
  if (words.length === 0) return 'XXX';
  if (words.length >= 3) return words.map(firstLetter).join('');
  if (words.length === 2) {
    const c1 = consonants(words[0]!);
    const c2 = consonants(words[1]!);
    if (c1.length >= 2) return padX(c1.slice(0, 2) + (c2[0] || ''), 3);
    const l1 = letters(words[0]!);
    return padX(l1.slice(0, 2) + (c2[0] || ''), 3);
  }
  const word = words[0]!;
  const L = letters(word);
  const C = consonants(word);
  if (L.length === 3 && C.length === 2) return L;
  if (C.length === 3) return C;
  if (C.length > 3) return padX(L.slice(0, 2) + C.slice(-1), 3);
  if (C.length === 2 && L.length >= 4) return padX((L[0] || '') + C, 3);
  return padX(C.length > 0 ? (L[0] || '') + C : L, 3);
}

export function abbreviateBrand(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'XXXX';
  const words = splitNameWords(trimmed);
  if (words.length >= 2) {
    const a = letters(words[0] || '').slice(0, 2);
    const b = letters(words[1] || '').slice(0, 2);
    return padX(a + b, 4);
  }
  const L = letters(words[0]!);
  const C = consonants(words[0]!);
  if (L.length === 4) return L;
  if (L.length <= 3) return padX(L, 4);
  if (C.length === 2 && L.length >= 5) return padX(L.slice(0, 3) + (C[1] || ''), 4);
  return padX(L.slice(0, 3) + C.slice(-1), 4);
}

function stripModelPunctuation(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/(\d)X(\d)/g, '$1$2')
    .replace(/[^A-Z0-9\s/]+/g, ' ')
    .replace(/&/g, ' AND ');
}

function encodeModelWord(word: string, isFirst: boolean): string {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    if (ch < 'A' || ch > 'Z') continue;
    if (isFirst && i === 0) {
      out += ch;
      continue;
    }
    if (isConsonant(ch)) out += ch;
  }
  return out;
}

export function abbreviateModel(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'XXXXXXXX';
  const words = stripModelPunctuation(trimmed).split(/[\s/]+/).filter(Boolean);
  if (words.length === 0) return 'XXXXXXXX';
  return words.map((word, i) => encodeModelWord(word, i === 0)).join('') || 'XXXXXXXX';
}

export function buildSkuPrefix(input: {
  departmentName?: string | null;
  categoryName?: string | null;
  brand?: string | null;
  model?: string | null;
}): string {
  return [
    departmentLetter(input.departmentName),
    abbreviateCategory(input.categoryName),
    abbreviateBrand(input.brand),
    abbreviateModel(input.model),
  ].join('-');
}

/**
 * List-row codes must be unique. Unit codes are `{prefix}-001`, so a colliding
 * list row uses `{prefix}~2` (tilde) instead of another hyphen suffix.
 */
export function uniqueItemCode(desired: string, used: Iterable<string>): string {
  const taken = new Set(used);
  if (!taken.has(desired)) return desired;
  let n = 2;
  while (taken.has(`${desired}~${n}`)) n += 1;
  return `${desired}~${n}`;
}

export function formatUnitCount(n: number): string {
  return String(n).padStart(3, '0');
}

export function formatUnitCode(prefix: string, n: number): string {
  return `${prefix}-${formatUnitCount(n)}`;
}

export function parseUnitCount(code: string | null | undefined, prefix: string): number | null {
  if (!code) return null;
  const head = `${prefix}-`;
  if (!code.startsWith(head)) return null;
  const suffix = code.slice(head.length);
  if (!/^\d+$/.test(suffix)) return null;
  const n = parseInt(suffix, 10);
  return Number.isFinite(n) ? n : null;
}

export function trailingUnitCount(code: string | null | undefined): number | null {
  if (!code) return null;
  const m = code.match(/-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function nextUnitCounts(used: Iterable<number>, howMany: number): number[] {
  const taken = new Set(used);
  const out: number[] = [];
  let n = 1;
  while (out.length < howMany) {
    if (!taken.has(n)) {
      out.push(n);
      taken.add(n);
    }
    n += 1;
  }
  return out;
}

/** Parse `Qty Available: N` (or `Quantity Available: N`) from CSV notes. */
export function parseQtyAvailable(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = notes.match(/(?:qty|quantity)\s*available\s*:\s*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePositiveInt(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseInt(String(raw).replace(/,/g, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MAX_IMPORT_UNITS = 999;

/** How many blank numbered units a CSV row should create. */
export function unitQtyFromCsvRow(row: Record<string, string | undefined>): number {
  const fromCol = parsePositiveInt(row.qty_available)
    ?? parsePositiveInt(row.qtyavailable)
    ?? parsePositiveInt(row.quantity)
    ?? parsePositiveInt(row.qty);
  const n = fromCol ?? parseQtyAvailable(row.notes) ?? 1;
  return Math.min(n, MAX_IMPORT_UNITS);
}
