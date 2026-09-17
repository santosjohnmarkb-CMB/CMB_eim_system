/**
 * Tiny RFC-4180-ish CSV row parser used by the bulk-import handlers
 * (packages). Handles double-quoted fields with embedded commas and the `""`
 * escape for a literal quote.
 *
 * Ported verbatim from the rental app's shared util so EIM's package import
 * behaves identically against operator-uploaded files.
 */
export function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

const EQUIPMENT_CSV_KNOWN_HEADERS = new Set([
  'name', 'equipment_name', 'item_name', 'equipment',
  'department', 'department_name', 'dept',
  'category', 'category_name', 'cat',
  'brand', 'model', 'item_type', 'qty_available', 'quantity',
  'base_price', 'notes', 'sub_category', 'subcategory', 'sub_category_name',
  'sub_sub_category', 'sub_subcategory', 'sub_sub', 'pricing_type',
]);

export function normalizeCsvHeader(h: string): string {
  return h.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function csvRowLooksLikeHeaders(cols: string[]): boolean {
  return cols.map(normalizeCsvHeader).filter((h) => EQUIPMENT_CSV_KNOWN_HEADERS.has(h)).length >= 2;
}

/** BOM, line endings, and tab/semicolon delimiters. Sample more than row 1 so Excel title rows don't hide a TSV. */
export function normalizeCsvText(csvContent: string): string {
  let text = csvContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const sample = text.split('\n').slice(0, 10).join('\n');
  const tabs = (sample.match(/\t/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  if (tabs > commas && tabs > semis) text = text.replace(/\t/g, ',');
  else if (semis > commas && semis > tabs) text = text.replace(/;/g, ',');
  return text;
}

export function splitCsvLines(csvContent: string): string[] {
  return normalizeCsvText(csvContent).split('\n').filter((l) => l.trim());
}

/** Excel often exports formula cells as `="text"` or `=""`. */
export function csvCellValue(raw: string): string {
  let v = raw.trim().replace(/^\uFEFF/, '');
  const formula = /^="([\s\S]*)"$/.exec(v);
  if (formula) v = formula[1] ?? '';
  if (v === '=' || v === '=""' || v === "=''") return '';
  return v.trim();
}

export function csvRowIsBlank(cols: string[]): boolean {
  return cols.every((c) => !csvCellValue(c));
}

/** Drop Excel/Numbers title rows like `Table 1,,,,,` so the real header row is first. */
export function skipCsvTitleRows(lines: string[]): string[] {
  const limit = Math.min(lines.length, 15);
  for (let i = 0; i < limit; i++) {
    if (!csvRowLooksLikeHeaders(parseCsvRow(lines[i]!))) continue;
    if (i > 0) console.log(`[csv] Skipping ${i} title row(s) before headers: "${lines[0]}"`);
    return lines.slice(i);
  }
  return lines;
}
