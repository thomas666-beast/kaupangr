/**
 * Minimal RFC-4180 CSV serializer.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {Array<{ key: string, label: string }>} columns
 * @param {{ separator?: string }} [opts]
 * @returns {string}
 */
export function toCsv(rows, columns, opts = {}) {
  const sep = opts.separator || ',';
  const lines = [];

  lines.push(columns.map(c => escapeCell(c.label, sep)).join(sep));

  for (const row of rows) {
    lines.push(
      columns.map(c => escapeCell(row == null ? '' : row[c.key], sep)).join(sep)
    );
  }

  return lines.join('\r\n') + '\r\n';
}

function escapeCell(value, sep) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const needsQuotes =
    str.includes('"') || str.includes(sep) || str.includes('\n') || str.includes('\r');
  if (!needsQuotes) return str;
  return '"' + str.replace(/"/g, '""') + '"';
}
