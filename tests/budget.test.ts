import { describe, expect, it } from 'vitest';
import { budgetReport, scoreBullets, trimOneMore, trimToBudget } from '@/lib/budget';
import { fitToPageLimit } from '@/lib/fit';
import { DEFAULT_SETTINGS, type JdAnalysis } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { defaultSelection, emptyJob, resolveResume } from '@/lib/selection';
import { renderAndInspect } from './helpers/pdf';

const master = SEED_MASTER;
const analysis: JdAnalysis = {
  title: 'Senior Platform Engineer',
  company: 'Acme',
  seniority: 'senior',
  domain: 'logistics',
  requiredSkills: ['Kubernetes', 'Golang', 'Kafka'],
  niceToHaves: ['OpenTelemetry'],
  keywords: ['distributed systems'],
};

const included = (sel: ReturnType<typeof defaultSelection>) => new Set(sel.blocks.flatMap((b) => (b.included ? b.bullets.filter((r) => r.included).map((r) => r.id) : [])));

describe('scoring', () => {
  it('ranks JD-relevant, quantified bullets above unrelated ones', () => {
    const s = scoreBullets(master, defaultSelection(master, emptyJob(), 'x'), analysis);
    // Kubernetes + metric > SQL reports for finance
    expect(s.get('b_nw_1')!).toBeGreaterThan(s.get('b_bp_3')!);
    // "golang" in the JD matches "Go" in the bullet through the skill alias
    expect(s.get('b_nw_3')!).toBeGreaterThan(s.get('b_lh_6')!);
  });
});

describe('trimToBudget', () => {
  it('drops lowest-score bullets first and keeps relevant ones', () => {
    const sel = defaultSelection(master, emptyJob(), 'x');
    const r = trimToBudget(master, sel, analysis, DEFAULT_SETTINGS, []);
    expect(r.unresolved).toEqual([]);
    expect(budgetReport(resolveResume(master, r.selection), DEFAULT_SETTINGS).over).toEqual([]);
    const kept = included(r.selection);
    for (const id of ['b_nw_1', 'b_nw_2', 'b_nw_3', 'b_nw_5']) expect(kept.has(id)).toBe(true);
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(r.dropped).not.toContain('b_nw_1');
  });

  it('never drops pinned bullets and keeps at least one bullet per included role', () => {
    const sel = defaultSelection(master, emptyJob(), 'x');
    const tight = { ...DEFAULT_SETTINGS, lineBudget: { ...DEFAULT_SETTINGS.lineBudget, experience: 8 } };
    const r = trimToBudget(master, sel, analysis, tight, ['b_bp_3']);
    const kept = included(r.selection);
    expect(kept.has('b_bp_3')).toBe(true);
    for (const b of r.selection.blocks.filter((x) => x.type === 'experience' && x.included)) {
      expect(b.bullets.some((x) => x.included)).toBe(true);
    }
    expect(r.unresolved).toContain('experience'); // impossible budget is reported, not hidden
  });

  it('two-page limit doubles the budget and trims less', () => {
    const sel = defaultSelection(master, emptyJob(), 'x');
    const one = trimToBudget(master, sel, analysis, DEFAULT_SETTINGS, []);
    const two = trimToBudget(master, sel, analysis, { ...DEFAULT_SETTINGS, pageLimit: 2 }, []);
    expect(two.dropped.length).toBeLessThan(one.dropped.length);
  });

  it('trimOneMore returns null when nothing is droppable', () => {
    const sel = defaultSelection(master, emptyJob(), 'x');
    for (const b of sel.blocks) b.bullets.forEach((r, i) => (r.included = i === 0));
    expect(trimOneMore(master, { ...sel, blocks: sel.blocks.filter((b) => b.type !== 'project') }, analysis, []).dropped).toBeNull();
  });
});

describe('fitToPageLimit with real PDF page counts', () => {
  it('ends on one page', async () => {
    const sel = defaultSelection(master, emptyJob(), 'x');
    const r = await fitToPageLimit(master, sel, analysis, DEFAULT_SETTINGS, [], async (s) => (await renderAndInspect(resolveResume(master, s))).pageCount);
    expect(r.fits).toBe(true);
    expect(r.pageCount).toBe(1);
  });
});
