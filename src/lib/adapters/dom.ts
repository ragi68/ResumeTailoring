/** DOM helpers shared by adapters: attaching files, locating targets, waiting for elements. */
import type { AttachOutcome, UploadTarget } from './types';

const RESUME_RE = /\b(resume|résumé|cv|curriculum)\b/i;
const NEGATIVE_RE = /\b(cover\s*letter|transcript|portfolio|photo|avatar|image|additional)\b/i;

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (!he.isConnected) return false;
  const style = he.ownerDocument.defaultView?.getComputedStyle(he);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = he.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Text that describes a file input: its own attributes first, then labels and nearby container text. */
export function describeInput(input: HTMLInputElement): { own: string; context: string } {
  const own: string[] = [input.name, input.id, input.getAttribute('aria-label') ?? ''];
  own.push(input.getAttribute('data-automation-id') ?? '', input.getAttribute('data-testid') ?? '');
  input.labels?.forEach((l) => own.push(l.textContent ?? ''));
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) own.push(input.ownerDocument.getElementById(id)?.textContent ?? '');
  }
  let context = '';
  let node: Element | null = input.parentElement;
  for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
    const text = normalizeSpace(node.textContent ?? '');
    if (text) {
      context = text.slice(0, 200);
      break;
    }
  }
  return { own: normalizeSpace(own.join(' ')), context };
}

export function acceptsPdf(input: HTMLInputElement): boolean {
  const accept = input.accept.trim().toLowerCase();
  if (!accept) return true;
  return accept.split(',').some((a) => {
    const t = a.trim();
    return t === '.pdf' || t === 'application/pdf' || t === 'application/*' || t === '*/*';
  });
}

export function scoreInput(input: HTMLInputElement): number {
  if (input.disabled || !acceptsPdf(input)) return -1;
  const { own, context } = describeInput(input);
  let score = 1;
  if (RESUME_RE.test(own)) score += 10;
  else if (RESUME_RE.test(context)) score += 4;
  if (NEGATIVE_RE.test(own)) score -= 8;
  else if (NEGATIVE_RE.test(context) && !RESUME_RE.test(context)) score -= 3;
  if (isVisible(input)) score += 1;
  return score;
}

/** All file inputs in the document, including inside open shadow roots. */
export function findFileInputs(root: Document | ShadowRoot): HTMLInputElement[] {
  const out: HTMLInputElement[] = [];
  const walk = (r: Document | ShadowRoot) => {
    r.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((i) => out.push(i));
    r.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };
  walk(root);
  return out;
}

export function bestFileInput(inputs: HTMLInputElement[]): UploadTarget | null {
  let best: UploadTarget | null = null;
  for (const el of inputs) {
    const score = scoreInput(el);
    if (score < 0) continue;
    if (!best || score > best.score) {
      const d = describeInput(el);
      best = { kind: 'input', el, score, label: (d.own || d.context).slice(0, 80) };
    }
  }
  return best;
}

const DROPZONE_SELECTORS = [
  '[data-automation-id="file-upload-drop-zone"]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="fileUpload" i]',
  '[class*="file-upload" i]',
  '[data-testid*="drop" i]',
];
const DROP_TEXT_RE = /(drag\s*(&|and|n)?\s*drop|drop\s+(your\s+)?(file|resume|cv)s?\s+here|drop files)/i;

export function findDropZone(doc: Document): UploadTarget | null {
  const candidates = new Set<HTMLElement>();
  for (const sel of DROPZONE_SELECTORS) doc.querySelectorAll<HTMLElement>(sel).forEach((e) => candidates.add(e));
  // Text-based: elements with short text that mentions drag & drop.
  doc.querySelectorAll<HTMLElement>('div, section, label').forEach((e) => {
    const text = e.textContent ?? '';
    if (text.length < 300 && DROP_TEXT_RE.test(text)) candidates.add(e);
  });
  let best: UploadTarget | null = null;
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const text = normalizeSpace(el.textContent ?? '');
    let score = 1;
    if (RESUME_RE.test(text)) score += 5;
    if (NEGATIVE_RE.test(text)) score -= 4;
    if (DROP_TEXT_RE.test(text)) score += 2;
    // Prefer the most specific (smallest) container, but only as a tie-breaker.
    const rect = el.getBoundingClientRect();
    score -= Math.min((rect.width * rect.height) / 2_000_000, 0.9);
    if (!best || score > best.score) best = { kind: 'dropzone', el, score, label: text.slice(0, 80) };
  }
  return best;
}

/**
 * Set files on an input the way a real user selection looks to frameworks:
 * use the native `files` setter from the prototype (bypasses React-style instance
 * overrides) and fire bubbling `input` and `change` events.
 */
export function setInputFiles(input: HTMLInputElement, file: File): boolean {
  const dt = new DataTransfer();
  dt.items.add(file);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
  if (setter) setter.call(input, dt.files);
  else input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return input.files?.length === 1 && input.files[0]?.name === file.name;
}

/** Simulate a user dragging a file onto an upload zone. */
export function simulateDrop(el: HTMLElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  const rect = el.getBoundingClientRect();
  const init: DragEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: dt,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  for (const type of ['dragenter', 'dragover', 'drop'] as const) {
    el.dispatchEvent(new DragEvent(type, init));
  }
}

export function attachToTarget(target: UploadTarget, file: File, adapter: string): AttachOutcome {
  if (target.kind === 'input') {
    const verified = setInputFiles(target.el, file);
    return {
      ok: true,
      method: 'input',
      adapter,
      verified,
      detail: verified
        ? `Attached to file input "${target.label || 'unlabeled'}"`
        : 'Set the input files but could not confirm the page kept them',
    };
  }
  simulateDrop(target.el, file);
  return {
    ok: true,
    method: 'dropzone',
    adapter,
    verified: false,
    detail: `Dropped the file on upload zone "${target.label || 'unlabeled'}". Check that the page shows it.`,
  };
}

/** Resolve with the first non-null result of `probe`, re-checking on DOM mutations until the timeout. */
export function waitFor<T>(doc: Document, probe: () => T | null, timeoutMs: number): Promise<T | null> {
  const immediate = probe();
  if (immediate || timeoutMs <= 0) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let done = false;
    const observer = new MutationObserver(() => {
      const v = probe();
      if (v) finish(v);
    });
    const timer = setTimeout(() => finish(probe()), timeoutMs);
    function finish(v: T | null) {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(v);
    }
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  });
}
