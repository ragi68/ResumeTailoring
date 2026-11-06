/**
 * Layered job description capture:
 *   (a) JSON-LD JobPosting  (b) site-specific selectors  (c) the user's selected text.
 * Manual paste in the panel is always available on top of this.
 */
import { normalizeSpace } from './dom';
import type { JobDescriptionCapture, SiteAdapter } from './types';

const MIN_JD_LENGTH = 200;

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** Convert HTML (as found in JSON-LD descriptions) to readable plain text. */
export function htmlToText(html: string, doc: Document): string {
  const el = doc.createElement('div');
  el.innerHTML = html.replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '$&\n').replace(/<li[^>]*>/gi, '$&• ');
  return cleanText(el.textContent ?? '');
}

export function cleanText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** innerText-like extraction that preserves block boundaries even in jsdom (no layout). */
export function elementText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, noscript, button, svg').forEach((n) => n.remove());
  return htmlToText(clone.innerHTML, el.ownerDocument);
}

function asObject(v: JsonValue | undefined): Record<string, JsonValue> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function findJobPosting(node: JsonValue): Record<string, JsonValue> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n);
      if (hit) return hit;
    }
    return null;
  }
  const obj = asObject(node);
  if (!obj) return null;
  const type = obj['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return obj;
  if (obj['@graph']) return findJobPosting(obj['@graph']);
  return null;
}

export function fromJsonLd(doc: Document): Omit<JobDescriptionCapture, 'url'> | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(script.textContent ?? '') as JsonValue;
    } catch {
      continue;
    }
    const posting = findJobPosting(parsed);
    if (!posting) continue;
    const description = typeof posting['description'] === 'string' ? posting['description'] : '';
    let text = htmlToText(description, doc);
    // Some sites HTML-escape the description twice; decode again if tags survived the first pass.
    if (/<\/?(p|li|ul|br|div|strong|b|h\d)\b[^>]*>/i.test(text)) text = htmlToText(text, doc);
    if (!text) continue;
    const org = asObject(posting['hiringOrganization']);
    return {
      title: typeof posting['title'] === 'string' ? normalizeSpace(posting['title']) : '',
      company: org && typeof org['name'] === 'string' ? normalizeSpace(org['name']) : '',
      text,
      source: 'json-ld',
    };
  }
  return null;
}

function fromSelection(doc: Document): Omit<JobDescriptionCapture, 'url'> | null {
  const sel = doc.getSelection?.()?.toString() ?? '';
  const text = cleanText(sel);
  if (text.length < 40) return null;
  return { title: '', company: '', text, source: 'selection' };
}

export type CaptureMode = 'auto' | 'selection';

/**
 * 'auto' walks the layers in order: JSON-LD, site selectors, then selected text.
 * 'selection' uses only the selected text (the panel's "Use selected text" button).
 */
export function captureJobDescription(
  doc: Document,
  adapter: SiteAdapter,
  mode: CaptureMode = 'auto',
): JobDescriptionCapture | null {
  const url = doc.location?.href ?? '';
  const selection = fromSelection(doc);
  if (mode === 'selection') return selection ? { ...selection, url } : null;
  const ld = fromJsonLd(doc);
  const site = adapter.getJobDescription(doc);
  if (ld && ld.text.length >= MIN_JD_LENGTH) {
    return {
      ...ld,
      title: ld.title || site?.title || '',
      company: ld.company || site?.company || '',
      url,
    };
  }
  if (site && site.text.length > 0) return { ...site, source: 'site', url };
  if (ld) return { ...ld, url };
  if (selection) return { ...selection, url };
  return null;
}
