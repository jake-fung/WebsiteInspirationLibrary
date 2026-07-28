const SECTIONS = [
  ['Aesthetics', 'aesthetics'],
  ['Reference', 'reference'],
  ['Intent', 'intent'],
];

/**
 * Assemble the copy-output markdown for an inspiration.
 * This is the single source of truth for copy shape — the frontend
 * fetches this rather than building markdown itself.
 */
export function toMarkdown(inspiration = {}) {
  const title = String(inspiration.title || '').trim() || 'Untitled';
  const parts = [`# ${title}`];

  const brief = String(inspiration.brief || '').trim();
  if (brief) parts.push(brief);

  for (const [heading, key] of SECTIONS) {
    const value = String(inspiration[key] || '').trim();
    if (value) parts.push(`## ${heading}\n${value}`);
  }

  return parts.join('\n\n') + '\n';
}
