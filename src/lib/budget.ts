/**
 * Page-length control. Estimates rendered lines per section, scores bullets, and trims the
 * lowest-scoring bullets until each section fits its line budget. The real PDF page count is the
 * final word; see fitToPageLimit in the app, which calls trimOneMore against the generated PDF.
 */
import { relevanceScore } from './keywords';
import type { JdAnalysis, LineBudget, MasterResume, SectionKey, Selection, Settings } from './schemas';
import { indexMaster, resolveResume, type ResolvedEntry, type ResolvedResume } from './selection';

/** Calibrated to the PDF layout in pdf/resumeDoc.ts (Letter, 10pt Roboto, 0.6in margins). */
export const LAYOUT = {
  bulletCharsPerLine: 104,
  textCharsPerLine: 112,
  headerLines: 3,
  sectionHeadingLines: 1.8,
  entryGapLines: 0.4,
} as const;

const wrap = (text: string, cpl: number) => Math.max(1, Math.ceil(text.length / cpl));

function entryLines(e: ResolvedEntry): number {
  let lines = LAYOUT.entryGapLines + 1; // title line
  if (e.type !== 'project' && (e.location || e.dates)) lines += 1;
  if (e.details) lines += wrap(e.details, LAYOUT.textCharsPerLine);
  for (const b of e.bullets) lines += wrap(b.text, LAYOUT.bulletCharsPerLine);
  return lines;
}

export type SectionLines = Record<SectionKey, number> & { header: number; total: number };

export function estimateLines(r: ResolvedResume): SectionLines {
  const section = (has: boolean, body: number) => (has ? LAYOUT.sectionHeadingLines + body : 0);
  const summary = section(!!r.summary, r.summary ? wrap(r.summary, LAYOUT.textCharsPerLine) : 0);
  const experience = section(r.experience.length > 0, r.experience.reduce((n, e) => n + entryLines(e), 0));
  const projects = section(r.projects.length > 0, r.projects.reduce((n, e) => n + entryLines(e), 0));
  const skills = section(
    r.skills.length > 0,
    r.skills.reduce((n, g) => n + wrap(`${g.group}: ${g.names.join(', ')}`, LAYOUT.textCharsPerLine), 0),
  );
  const education = section(r.education.length > 0, r.education.reduce((n, e) => n + entryLines(e), 0));
  const header = LAYOUT.headerLines;
  return { header, summary, experience, projects, skills, education, total: header + summary + experience + projects + skills + education };
}

export function effectiveBudget(settings: Pick<Settings, 'lineBudget' | 'pageLimit'>): LineBudget {
  const m = settings.pageLimit;
  const b = settings.lineBudget;
  return { summary: b.summary * m, experience: b.experience * m, projects: b.projects * m, skills: b.skills * m, education: b.education * m };
}

export interface BudgetReport {
  lines: SectionLines;
  budget: LineBudget;
  over: SectionKey[];
}

export function budgetReport(r: ResolvedResume, settings: Pick<Settings, 'lineBudget' | 'pageLimit'>): BudgetReport {
  const lines = estimateLines(r);
  const budget = effectiveBudget(settings);
  const over = (Object.keys(budget) as SectionKey[]).filter((k) => lines[k] > budget[k] + 0.01);
  return { lines, budget, over };
}

// ---------------- scoring ----------------

/**
 * Bullet score: JD relevance (required terms x3) + 1 for a metric + a bonus for its position in the
 * block (the order reflects the model's or the user's ranking). Higher is more valuable.
 */
export function scoreBullets(master: MasterResume, sel: Selection, analysis: JdAnalysis | null): Map<string, number> {
  const idx = indexMaster(master);
  const scores = new Map<string, number>();
  for (const block of sel.blocks) {
    const included = block.bullets.filter((b) => b.included);
    included.forEach((ref, i) => {
      const bullet = idx.bullets.get(ref.id);
      if (!bullet) return;
      const text = sel.textOverrides[ref.id] ?? bullet.text;
      const position = included.length > 1 ? 1.5 * (1 - i / (included.length - 1)) : 1.5;
      scores.set(ref.id, relevanceScore(master, text, analysis) + (bullet.hasMetric ? 1 : 0) + position);
    });
  }
  return scores;
}

// ---------------- trimming ----------------

export interface TrimResult {
  selection: Selection;
  dropped: string[];
  /** Sections still over budget that trimming could not fix (e.g. summary too long). */
  unresolved: SectionKey[];
}

const sectionOfBlock = (type: string): SectionKey | null => (type === 'experience' ? 'experience' : type === 'project' ? 'projects' : null);

/**
 * Exclude the single lowest-scoring droppable bullet, optionally limited to one section.
 * Droppable: included, not pinned, and not the last included bullet of its block.
 * Returns the dropped bullet id, or null if nothing could be dropped.
 */
export function dropLowestBullet(
  master: MasterResume,
  sel: Selection,
  analysis: JdAnalysis | null,
  pins: ReadonlySet<string>,
  section?: SectionKey,
): string | null {
  const scores = scoreBullets(master, sel, analysis);
  let best: { ref: { id: string; included: boolean }; score: number } | null = null;
  for (const block of sel.blocks) {
    if (!block.included) continue;
    const sec = sectionOfBlock(block.type);
    if (!sec || (section && sec !== section)) continue;
    if (block.bullets.filter((b) => b.included).length <= 1) continue;
    for (const ref of block.bullets) {
      if (!ref.included || pins.has(ref.id)) continue;
      const score = scores.get(ref.id) ?? 0;
      if (!best || score < best.score) best = { ref, score };
    }
  }
  if (!best) return null;
  best.ref.included = false;
  return best.ref.id;
}

/** Exclude the lowest-value unpinned project (used when projects are down to one bullet each). */
function dropLowestProject(master: MasterResume, sel: Selection, analysis: JdAnalysis | null, pins: ReadonlySet<string>): string | null {
  const scores = scoreBullets(master, sel, analysis);
  let best: { block: Selection['blocks'][number]; score: number } | null = null;
  for (const b of sel.blocks) {
    if (b.type !== 'project' || !b.included || pins.has(b.refId)) continue;
    if (b.bullets.some((r) => r.included && pins.has(r.id))) continue;
    const s = b.bullets.filter((r) => r.included).reduce((n, r) => n + (scores.get(r.id) ?? 0), 0);
    if (!best || s < best.score) best = { block: b, score: s };
  }
  if (!best) return null;
  best.block.included = false;
  return best.block.refId;
}

/** Remove skills that match no JD term, from the end, while the skills section is over budget. */
function dropWeakestSkill(master: MasterResume, sel: Selection, analysis: JdAnalysis | null, pins: ReadonlySet<string>): string | null {
  const idx = indexMaster(master);
  for (let i = sel.skillIds.length - 1; i >= 0; i--) {
    const id = sel.skillIds[i]!;
    if (pins.has(id)) continue;
    const s = idx.skills.get(id);
    const text = s ? [s.name, ...s.aliases].join(' , ') : '';
    if (relevanceScore(master, text, analysis) === 0) {
      sel.skillIds.splice(i, 1);
      return id;
    }
  }
  return null;
}

/** Trim the selection until every section fits its line budget (estimation-based). */
export function trimToBudget(
  master: MasterResume,
  selection: Selection,
  analysis: JdAnalysis | null,
  settings: Pick<Settings, 'lineBudget' | 'pageLimit'>,
  pinList: readonly string[],
): TrimResult {
  const sel = structuredClone(selection);
  const pins = new Set(pinList);
  const dropped: string[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const { over } = budgetReport(resolveResume(master, sel), settings);
    let progressed = false;
    for (const sec of over) {
      let id: string | null = null;
      if (sec === 'experience') id = dropLowestBullet(master, sel, analysis, pins, 'experience');
      else if (sec === 'projects') id = dropLowestBullet(master, sel, analysis, pins, 'projects') ?? dropLowestProject(master, sel, analysis, pins);
      else if (sec === 'skills') id = dropWeakestSkill(master, sel, analysis, pins);
      if (id) {
        dropped.push(id);
        progressed = true;
      }
    }
    if (!progressed) {
      return { selection: sel, dropped, unresolved: budgetReport(resolveResume(master, sel), settings).over };
    }
  }
  return { selection: sel, dropped, unresolved: budgetReport(resolveResume(master, sel), settings).over };
}

/**
 * One more trim step when the real PDF still overflows the page limit: drop the lowest-scoring
 * bullet from any section, else the weakest project.
 */
export function trimOneMore(master: MasterResume, selection: Selection, analysis: JdAnalysis | null, pinList: readonly string[]): { selection: Selection; dropped: string | null } {
  const sel = structuredClone(selection);
  const pins = new Set(pinList);
  const dropped = dropLowestBullet(master, sel, analysis, pins) ?? dropLowestProject(master, sel, analysis, pins);
  return { selection: sel, dropped };
}
