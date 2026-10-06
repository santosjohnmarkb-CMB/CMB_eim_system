import ExcelJS from 'exceljs';
import { normalizeCsvHeader, parseCsvRow, skipCsvTitleRows, splitCsvLines } from './csv';

/** Headers the package importer accepts, before alias folding. */
export const PACKAGE_CSV_KNOWN_HEADERS = new Set([
  'package_name', 'package', 'pkg_name', 'package_title',
  'description',
  'main_equipment_code', 'main_code', 'main_item_code', 'main_equipment',
  'component_equipment_code', 'component_code', 'component_item_code', 'component_equipment',
  'qty', 'quantity', 'included_qty',
  'is_required', 'package_cost',
]);

export const PACKAGE_REQUIRED_HEADERS = [
  'package_name', 'main_equipment_code', 'component_equipment_code', 'qty',
] as const;

export function canonicalPackageHeader(raw: string): string {
  switch (normalizeCsvHeader(raw)) {
    case 'quantity':
    case 'included_qty':
      return 'qty';
    case 'package':
    case 'pkg_name':
    case 'package_title':
      return 'package_name';
    case 'main_code':
    case 'main_item_code':
    case 'main_equipment':
      return 'main_equipment_code';
    case 'component_code':
    case 'component_item_code':
    case 'component_equipment':
      return 'component_equipment_code';
    default:
      return normalizeCsvHeader(raw);
  }
}

export function isXlsxBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

export function bufferToImportText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(Math.max(0, buf.length - 2));
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1]!;
      swapped[i - 1] = buf[i]!;
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf-8');
}

export function readPackageImportTable(csvContent: string): {
  headers: string[];
  rawHeaders: string[];
  lines: string[];
} {
  const lines = skipCsvTitleRows(splitCsvLines(csvContent), PACKAGE_CSV_KNOWN_HEADERS);
  if (lines.length < 2) throw new Error('Import file must have a header row and at least one data row');
  const rawHeaders = parseCsvRow(lines[0]!).map((h) => h.trim().replace(/^\uFEFF/, ''));
  const headers = rawHeaders.map(canonicalPackageHeader);
  return { headers, rawHeaders, lines };
}

function excelCellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text ?? '') : ''))
        .join('');
    }
    if (typeof obj.text === 'string') return obj.text;
    if ('result' in obj && obj.result !== value) return excelCellText(obj.result);
  }
  return '';
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowCells(row: ExcelJS.Row): string[] {
  let last = 0;
  row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
    if (colNumber > last) last = colNumber;
  });
  const cells: string[] = [];
  for (let c = 1; c <= last; c++) cells.push(excelCellText(row.getCell(c).value).trim());
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function sheetHasPackageHeaders(sheet: ExcelJS.Worksheet): boolean {
  const limit = Math.min(sheet.rowCount || 0, 15);
  for (let r = 1; r <= limit; r++) {
    const hits = rowCells(sheet.getRow(r))
      .map(canonicalPackageHeader)
      .filter((h) => (PACKAGE_REQUIRED_HEADERS as readonly string[]).includes(h)).length;
    if (hits >= 2) return true;
  }
  return false;
}

const SKIP_SHEET_NAMES = new Set(['instructions', 'equipment reference']);

export async function xlsxBufferToPackageCsv(buf: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  // exceljs typings still expect the pre-Node-22 Buffer shape.
  await workbook.xlsx.load(buf as unknown as Parameters<ExcelJS.Xlsx['load']>[0]);
  const named = workbook.getWorksheet('Package Import');
  const sheet = (named && sheetHasPackageHeaders(named) ? named : undefined)
    ?? workbook.worksheets.find((ws) => !SKIP_SHEET_NAMES.has(ws.name.trim().toLowerCase()) && sheetHasPackageHeaders(ws))
    ?? named
    ?? workbook.worksheets.find((ws) => !SKIP_SHEET_NAMES.has(ws.name.trim().toLowerCase()))
    ?? workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no sheets to import');

  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = rowCells(row);
    if (cells.some((c) => c !== '')) lines.push(cells.map(csvEscape).join(','));
  });
  if (lines.length === 0) throw new Error('The Excel file has no rows to import');
  return lines.join('\n');
}
