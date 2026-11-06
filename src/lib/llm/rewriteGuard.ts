/**
 * Honesty guard for rewrite suggestions: a rewrite may rephrase, but must not add numbers,
 * technologies, or other proper terms that the original bullet doesn't support.
 */
import { containsTerm, normalizeTerm } from '../keywords';
import type { MasterResume } from '../schemas';

export interface RewriteSuggestion {
  bulletId: string;
  original: string;
  text: string;
  reason: string;
}

const NUMBER_RE = /[$€£]?\d[\d,.]*\s*(%|k|m|b|x|ms|s)?/gi;

function numbers(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) => n.toLowerCase().replace(/[,\s]/g, '').replace(/\.$/, ''));
}

/** Groups of interchangeable terms: each master skill with its aliases. */
function synonymGroups(master: MasterResume): string[][] {
  return master.skillGroups.flatMap((g) => g.skills.map((s) => [s.name, ...s.aliases].map(normalizeTerm)));
}

/** Capitalized or tech-looking tokens (Kubernetes, gRPC, Node.js, C++, AWS), ignoring the first word. */
function properTerms(text: string): string[] {
  const words = text.split(/\s+/).map((w) => w.replace(/^[("'“]+|[)"'”,;:!?]+$|\.$/g, ''));
  return words.filter((w, i) => i > 0 && w.length > 1 && (/^[A-Z]/.test(w) || /[a-z][A-Z]/.test(w) || /[+#]/.test(w) || /\w\.\w/.test(w)));
}

/**
 * @param jdTerms Job-description terms. A rewrite must not introduce one the original lacks
 *   (that is how keyword stuffing turns into an unsupported claim), unless it's an exact synonym.
 */
export function checkRewrite(original: string, rewrite: string, master: MasterResume, jdTerms: string[] = []): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const r = rewrite.trim();
  if (!r) return { ok: false, problems: ['empty'] };
  if (normalizeTerm(r) === normalizeTerm(original)) return { ok: false, problems: ['no change'] };
  if (r.length > original.length * 1.5 + 40) problems.push('much longer than the original');

  const origNums = new Set(numbers(original));
  for (const n of numbers(r)) if (!origNums.has(n)) problems.push(`adds the number "${n}"`);

  const origNorm = ` ${normalizeTerm(original)} `;
  const groups = synonymGroups(master);
  const inOriginal = (term: string) => {
    const t = normalizeTerm(term);
    if (!t) return true;
    if (origNorm.includes(` ${t} `)) return true;
    // An exact synonym of something in the original (e.g. "Golang" for "Go") is allowed.
    return groups.some((g) => g.includes(t) && g.some((alt) => origNorm.includes(` ${alt} `)));
  };
  const flagged = new Set<string>();
  for (const term of properTerms(r)) {
    if (!inOriginal(term)) flagged.add(term);
  }
  for (const term of jdTerms) {
    if (containsTerm(r, term) && !inOriginal(term)) flagged.add(term);
  }
  for (const term of flagged) problems.push(`adds "${term}", which the original doesn't mention`);
  return { ok: problems.length === 0, problems };
}

// ---------------- word diff for the accept/reject UI ----------------

export type DiffPart = { type: 'same' | 'del' | 'ins'; text: string };

export function wordDiff(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/).filter((t) => t !== '');
  const y = b.split(/(\s+)/).filter((t) => t !== '');
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('same', x[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('del', x[i++]!);
    else push('ins', y[j++]!);
  }
  while (i < n) push('del', x[i++]!);
  while (j < m) push('ins', y[j++]!);
  return parts;
}
