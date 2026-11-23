import { SELECTORS } from './selectors.js';

/** @param {Element} formalContent */
export function extractFormalAnswer(formalContent) {
  const view = formalContent.ownerDocument.defaultView;
  const root = formalContent.cloneNode(true);
  if (!view || !(root instanceof view.Element)) {
    return '';
  }
  for (const excluded of root.querySelectorAll(
    `${SELECTORS.thinkContent}, [data-ds-operation-bar], button, [role="button"]`,
  )) {
    excluded.remove();
  }
  return serializeChildren(root)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {Element} element
 * @returns {string}
 */
function serializeChildren(element) {
  return [...element.childNodes]
    .map((node) => serializeNode(node))
    .filter(Boolean)
    .join('')
    .replace(/[ \t]+\n/g, '\n');
}

/**
 * @param {Node} node
 * @returns {string}
 */
function serializeNode(node) {
  const view = node.ownerDocument?.defaultView;
  if (!view) {
    return '';
  }
  if (node.nodeType === view.Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (/^\s*$/.test(text) && hasBlockChildren(node.parentElement)) {
      return '';
    }
    return text.replace(/[\t\n\r ]+/g, ' ');
  }
  if (!(node instanceof view.Element)) {
    return '';
  }
  if (node.matches(SELECTORS.thinkContent)) {
    return '';
  }

  const tag = node.tagName.toLowerCase();
  const tex = isMathContainer(node) ? mathAnnotation(node) : null;
  if (tex !== null) {
    const display =
      node.classList.contains('katex-display') ||
      Boolean(node.closest('.katex-display'));
    return display ? `$$${tex}$$` : `$${tex}$`;
  }
  if (/^h[1-6]$/.test(tag)) {
    return `${'#'.repeat(Number(tag[1]))} ${inlineText(node)}\n\n`;
  }
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    return `${serializeChildren(node).trim()}\n\n`;
  }
  if (tag === 'br') {
    return '\n';
  }
  if (tag === 'pre') {
    const code = node.querySelector('code') ?? node;
    const language =
      [...code.classList]
        .find((name) => name.startsWith('language-'))
        ?.slice('language-'.length) ?? '';
    return `\`\`\`${language}\n${(code.textContent ?? '').replace(/\n$/, '')}\n\`\`\`\n\n`;
  }
  if (tag === 'code') {
    return `\`${node.textContent ?? ''}\``;
  }
  if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    return `${[...node.children]
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map(
        (child, index) =>
          `${ordered ? `${index + 1}.` : '-'} ${inlineText(child)}`,
      )
      .join('\n')}\n\n`;
  }
  if (tag === 'li') {
    return inlineText(node);
  }
  if (tag === 'table') {
    return `${serializeTable(node)}\n\n`;
  }
  if (tag === 'blockquote') {
    return `${serializeChildren(node)
      .trim()
      .split('\n')
      .map((/** @type {string} */ line) => `> ${line}`)
      .join('\n')}\n\n`;
  }

  return serializeChildren(node);
}

/** @param {Element} table */
function serializeTable(table) {
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.children]
      .filter((cell) => /^(TD|TH)$/.test(cell.tagName))
      .map((cell) => inlineText(cell).replace(/\|/g, '\\|')),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) {
    return '';
  }
  const normalized = rows.map((row) => [
    ...row,
    ...Array(width - row.length).fill(''),
  ]);
  const header = normalized[0];
  return [
    `| ${header.join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/**
 * @param {Element} element
 * @returns {string}
 */
function inlineText(element) {
  return serializeChildren(element)
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** @param {Element} element */
function isMathContainer(element) {
  return (
    element.matches('.katex, .katex-display, math') ||
    Boolean(element.getAttribute('data-tex'))
  );
}

/** @param {Element | null} element */
function hasBlockChildren(element) {
  return Boolean(
    element?.querySelector(
      ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p, :scope > div, :scope > section, :scope > article, :scope > ul, :scope > ol, :scope > pre, :scope > table, :scope > blockquote',
    ),
  );
}

/** @param {Element} element */
function mathAnnotation(element) {
  const annotation = element.querySelector(
    'annotation[encoding="application/x-tex"]',
  );
  return annotation ? (annotation.textContent ?? '').trim() : null;
}
