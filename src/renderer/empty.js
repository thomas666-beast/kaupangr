export function emptyState(colspan, title, hint, action = '') {
  return `
    <tr><td colspan="${colspan}" class="empty">
      <strong>${title}</strong>
      <div class="empty-hint">${hint}</div>
      ${action}
    </td></tr>`;
}
