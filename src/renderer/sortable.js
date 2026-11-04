export function sortRows(rows, key, dir = 'asc') {
  const mul = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * mul;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * mul;
  });
}

export function headerCell(label, key, sort, cls = '') {
  const arrow = sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th class="sortable ${cls}" data-key="${key}">${label}<span class="arrow">${arrow}</span></th>`;
}
