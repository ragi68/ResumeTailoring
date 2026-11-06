import { describe, expect, it } from 'vitest';
import { SEED_MASTER } from '@/lib/seed';
import {
  applyPins,
  applyPlan,
  defaultSelection,
  emptyJob,
  moveBlockWithinType,
  reconcileSelection,
  resolveResume,
  resumeToPlainText,
} from '@/lib/selection';

const master = SEED_MASTER;
const base = () => defaultSelection(master, emptyJob(), 'job1');

describe('applyPlan (selection application)', () => {
  it('orders planned blocks first, includes only planned bullets in plan order, excludes the rest', () => {
    const sel = applyPlan(
      master,
      {
        summaryId: 'sum_ml',
        blocks: [
          { refId: 'exp_lumen', bulletIds: ['b_lh_4', 'b_lh_1'] },
          { refId: 'exp_northwind', bulletIds: ['b_nw_2'] },
          { refId: 'proj_transit', bulletIds: ['b_tr_1', 'b_tr_2'] },
        ],
        skillIds: ['sk_python', 'sk_sklearn'],
      },
      [],
      base(),
    );
    expect(sel.origin).toBe('llm');
    expect(sel.summaryId).toBe('sum_ml');
    const exp = sel.blocks.filter((b) => b.type === 'experience');
    expect(exp.map((b) => [b.refId, b.included])).toEqual([
      ['exp_lumen', true],
      ['exp_northwind', true],
      ['exp_brightpath', false],
    ]);
    const lumen = exp[0]!;
    expect(lumen.bullets.slice(0, 2)).toEqual([
      { id: 'b_lh_4', included: true },
      { id: 'b_lh_1', included: true },
    ]);
    expect(lumen.bullets.slice(2).every((b) => !b.included)).toBe(true);
    expect(lumen.bullets).toHaveLength(6); // nothing lost, just excluded
    const projects = sel.blocks.filter((b) => b.type === 'project');
    expect(projects[0]!.refId).toBe('proj_transit');
    expect(projects.filter((p) => p.included)).toHaveLength(1);
    // Education is always included.
    expect(sel.blocks.find((b) => b.type === 'education')!.included).toBe(true);
    expect(sel.skillIds).toEqual(['sk_python', 'sk_sklearn']);
  });

  it('forces pinned items in even if the plan left them out', () => {
    const sel = applyPlan(master, { summaryId: null, blocks: [{ refId: 'exp_northwind', bulletIds: ['b_nw_1'] }], skillIds: [] }, ['b_bp_3', 'proj_tracekit', 'sk_java'], base());
    const bp = sel.blocks.find((b) => b.refId === 'exp_brightpath')!;
    expect(bp.included).toBe(true);
    expect(bp.bullets.find((b) => b.id === 'b_bp_3')!.included).toBe(true);
    expect(sel.blocks.find((b) => b.refId === 'proj_tracekit')!.included).toBe(true);
    expect(sel.skillIds).toContain('sk_java');
    // Summary falls back to the base selection's when the plan has none.
    expect(sel.summaryId).toBe(base().summaryId);
  });

  it('never mutates the master', () => {
    const before = JSON.stringify(master);
    applyPlan(master, { summaryId: 'sum_ml', blocks: [{ refId: 'exp_lumen', bulletIds: ['b_lh_1'] }], skillIds: ['sk_go'] }, [], base());
    expect(JSON.stringify(master)).toBe(before);
  });
});

describe('reconcileSelection', () => {
  it('drops deleted items and appends new master items as excluded', () => {
    const sel = base();
    const m = structuredClone(master);
    m.experience[0]!.bullets.splice(0, 1); // delete b_nw_1
    m.experience[0]!.bullets.push({ id: 'b_new', text: 'New thing', tags: [], hasMetric: false, alternates: [] });
    m.projects.push({ id: 'proj_new', name: 'New', links: [], bullets: [], tags: [] });
    const r = reconcileSelection({ ...sel, textOverrides: { b_nw_1: 'x', b_nw_2: 'y' } }, m);
    const nw = r.blocks.find((b) => b.refId === 'exp_northwind')!;
    expect(nw.bullets.find((b) => b.id === 'b_nw_1')).toBeUndefined();
    expect(nw.bullets.at(-1)).toEqual({ id: 'b_new', included: false });
    expect(r.blocks.find((b) => b.refId === 'proj_new')!.included).toBe(false);
    expect(r.textOverrides).toEqual({ b_nw_2: 'y' });
  });
});

describe('ordering and resolving', () => {
  it('moves blocks only within their type', () => {
    const sel = base();
    moveBlockWithinType(sel, 'experience', 0, 2);
    expect(sel.blocks.filter((b) => b.type === 'experience').map((b) => b.refId)).toEqual(['exp_lumen', 'exp_brightpath', 'exp_northwind']);
    expect(sel.blocks.filter((b) => b.type === 'project').map((b) => b.refId)).toEqual(['proj_tracekit', 'proj_mealplan', 'proj_transit']);
  });

  it('resolves overrides, exclusions, and pins', () => {
    const sel = base();
    sel.blocks[0]!.bullets[0]!.included = false;
    sel.blocks[0]!.bullets[1]!.included = false;
    sel.textOverrides['b_nw_3'] = 'Rephrased pricing bullet';
    const pinned = applyPins(sel, ['b_nw_2'], master);
    const r = resolveResume(master, pinned);
    const nw = r.experience[0]!;
    expect(nw.bullets.map((b) => b.id)).toEqual(['b_nw_2', 'b_nw_3', 'b_nw_4', 'b_nw_5', 'b_nw_6', 'b_nw_7']);
    expect(nw.bullets[1]).toMatchObject({ text: 'Rephrased pricing bullet', overridden: true });
    expect(nw.dates).toBe('Mar 2021 – Present');
    const text = resumeToPlainText(r);
    expect(text).toContain('EXPERIENCE');
    expect(text).toContain('• Rephrased pricing bullet');
  });
});
