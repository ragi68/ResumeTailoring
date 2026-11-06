/**
 * Keyword matching with skill aliases, and keyword gap analysis (covered / suggested / missing).
 * Suggestions only ever point at content that already exists in the master.
 */
import type { JdAnalysis, MasterResume, Selection } from './schemas';
import { indexMaster, resolveResume } from './selection';

/** Lowercase, keep characters meaningful in tech terms (+ # . /), drop sentence punctuation. */
export function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ') // trailing periods ("Kubernetes.") but keep "node.js"
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Light stemming applied to both sides of a match, so "mentoring" matches "Mentored",
 * "engineering" matches "engineer", and "systems" matches "system". Short words are left alone.
 */
export function stem(word: string): string {
  if (word.length <= 4 || /[^a-z]/.test(word)) return word;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ss')) return word;
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

const stemmed = (s: string) => normalizeTerm(s).split(' ').map(stem).join(' ');

/** True if `term` appears in `text` as a whole word/phrase (after normalization and stemming). */
export function containsTerm(text: string, term: string): boolean {
  const t = stemmed(term);
  if (!t) return false;
  return ` ${stemmed(text)} `.includes(` ${t} `);
}

function variantsOf(term: string): string[] {
  const t = normalizeTerm(term);
  return t ? [t] : [];
}

export interface SkillMatch {
  skillId: string;
  name: string;
}

/** Find the master skill a JD term refers to, by name or alias. */
export function findSkillForTerm(master: MasterResume, term: string): SkillMatch | null {
  const t = normalizeTerm(term);
  for (const g of master.skillGroups) {
    for (const s of g.skills) {
      if ([s.name, ...s.aliases].some((n) => normalizeTerm(n) === t)) return { skillId: s.id, name: s.name };
    }
  }
  return null;
}

/** All surface forms that count as the term: the term, plus the matched skill's name and aliases. */
export function termForms(master: MasterResume, term: string): string[] {
  const forms = new Set(variantsOf(term));
  const skill = findSkillForTerm(master, term);
  if (skill) {
    for (const g of master.skillGroups)
      for (const s of g.skills)
        if (s.id === skill.skillId) [s.name, ...s.aliases].forEach((n) => variantsOf(n).forEach((v) => forms.add(v)));
  }
  return [...forms].filter(Boolean);
}

export function matchesAny(text: string, forms: string[]): boolean {
  return forms.some((f) => containsTerm(text, f));
}

// ---------------- gap analysis ----------------

export type KeywordPriority = 'required' | 'nice' | 'keyword';

export type KeywordSuggestion =
  | { kind: 'add-skill'; skillId: string; label: string }
  | { kind: 'include-bullet'; bulletId: string; blockId: string; label: string }
  | { kind: 'use-alternate'; bulletId: string; blockId: string; alternate: string; label: string };

export interface KeywordStatus {
  keyword: string;
  priority: KeywordPriority;
  status: 'covered' | 'suggested' | 'missing';
  /** Where it is covered (human-readable). */
  coveredBy: string[];
  /** Best suggestion first. Empty when status is 'missing' ("no supported place"). */
  suggestions: KeywordSuggestion[];
}

export function jdKeywords(analysis: JdAnalysis): { keyword: string; priority: KeywordPriority }[] {
  const out: { keyword: string; priority: KeywordPriority }[] = [];
  const seen = new Set<string>();
  const push = (k: string, priority: KeywordPriority) => {
    const n = normalizeTerm(k);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ keyword: k.trim(), priority });
  };
  analysis.requiredSkills.forEach((k) => push(k, 'required'));
  analysis.niceToHaves.forEach((k) => push(k, 'nice'));
  analysis.keywords.forEach((k) => push(k, 'keyword'));
  return out;
}

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function analyzeKeywordGaps(master: MasterResume, sel: Selection, analysis: JdAnalysis): KeywordStatus[] {
  const idx = indexMaster(master);
  const resolved = resolveResume(master, sel);
  const shownSkills = new Set(sel.skillIds);
  const blockName = new Map<string, string>([
    ...master.experience.map((e) => [e.id, `${e.title}, ${e.company}`] as const),
    ...master.projects.map((p) => [p.id, p.name] as const),
  ]);

  const includedBullets = new Set<string>();
  for (const b of sel.blocks) if (b.included) b.bullets.forEach((r) => r.included && includedBullets.add(r.id));

  return jdKeywords(analysis).map(({ keyword, priority }) => {
    const forms = termForms(master, keyword);
    const coveredBy: string[] = [];
    if (matchesAny(resolved.summary, forms)) coveredBy.push('Summary');
    for (const e of [...resolved.experience, ...resolved.projects]) {
      if (matchesAny(`${e.title} ${e.org}`, forms)) coveredBy.push(e.title);
      for (const b of e.bullets) if (matchesAny(b.text, forms)) coveredBy.push(truncate(b.text, 40));
    }
    for (const g of resolved.skills) for (const n of g.names) if (forms.some((f) => normalizeTerm(n) === f)) coveredBy.push(`Skills: ${n}`);
    if (coveredBy.length) return { keyword, priority, status: 'covered' as const, coveredBy, suggestions: [] };

    const suggestions: KeywordSuggestion[] = [];
    const skill = findSkillForTerm(master, keyword);
    if (skill && !shownSkills.has(skill.skillId)) {
      suggestions.push({ kind: 'add-skill', skillId: skill.skillId, label: `Show skill "${skill.name}"` });
    }
    for (const [bulletId, bullet] of idx.bullets) {
      const blockId = idx.bulletOwner.get(bulletId)!;
      const where = blockName.get(blockId) ?? '';
      const current = sel.textOverrides[bulletId] ?? bullet.text;
      if (!includedBullets.has(bulletId) && matchesAny(bullet.text, forms)) {
        suggestions.push({ kind: 'include-bullet', bulletId, blockId, label: `Include bullet from ${where}: "${truncate(bullet.text)}"` });
      } else if (!matchesAny(current, forms)) {
        const alt = bullet.alternates.find((a) => matchesAny(a, forms));
        if (alt) suggestions.push({ kind: 'use-alternate', bulletId, blockId, alternate: alt, label: `Use your alternate phrasing: "${truncate(alt)}"` });
      }
    }
    return {
      keyword,
      priority,
      status: suggestions.length ? ('suggested' as const) : ('missing' as const),
      coveredBy: [],
      suggestions,
    };
  });
}

/** Keyword relevance of a piece of text: required terms weigh more than nice-to-haves. */
export function relevanceScore(master: MasterResume, text: string, analysis: JdAnalysis | null): number {
  if (!analysis) return 0;
  let score = 0;
  for (const { keyword, priority } of jdKeywords(analysis)) {
    if (matchesAny(text, termForms(master, keyword))) score += priority === 'required' ? 3 : 1;
  }
  return score;
}
