import { escHtml } from './escape-html.js';

/**
 * Markdown → HTML voor oefeningbeschrijvingen. Vereist `marked` en `DOMPurify` (globals in index.html).
 * XSS: output is altijd door DOMPurify gehaald; bij ontbrekende libs valt de tekst terug op geescapte plain text.
 */
export function renderExerciseMarkdown(raw) {
  const s = raw == null ? '' : String(raw);
  if (!s.trim()) return '';

  const markedLib = typeof globalThis.marked !== 'undefined' ? globalThis.marked : null;
  const purify = typeof globalThis.DOMPurify !== 'undefined' ? globalThis.DOMPurify : null;

  if (!markedLib || !purify) {
    return `<p class="md-exercise-fallback">${escHtml(s).replace(/\n/g, '<br>')}</p>`;
  }

  try {
    const parse =
      typeof markedLib.parse === 'function'
        ? markedLib.parse.bind(markedLib)
        : typeof markedLib === 'function'
          ? markedLib
          : null;
    if (!parse) {
      return `<p class="md-exercise-fallback">${escHtml(s).replace(/\n/g, '<br>')}</p>`;
    }
    const html = parse(s, { breaks: true });
    return purify.sanitize(html);
  } catch (_) {
    return `<p class="md-exercise-fallback">${escHtml(s).replace(/\n/g, '<br>')}</p>`;
  }
}
