import { describe, expect, it } from 'vitest';
import { budgetReport, trimToBudget } from '@/lib/budget';
import { DEFAULT_SETTINGS } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { defaultSelection, emptyJob, resolveResume } from '@/lib/selection';
import { renderAndInspect } from './helpers/pdf';

describe('resume PDF', () => {
  it('is a real text PDF with standard headings and plain bullets', async () => {
    const sel = defaultSelection(SEED_MASTER, emptyJob(), 's1');
    const pdf = await renderAndInspect(resolveResume(SEED_MASTER, sel));
    const text = pdf.pages.join('\n');
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-');
    for (const h of ['Summary', 'Experience', 'Projects', 'Skills', 'Education']) expect(text).toContain(h);
    expect(text).toContain('Alex Rivera');
    expect(text).toContain('•');
    expect(text).toContain('Mar 2021 – Present');
    expect(text).not.toMatch(/undefined|null|\[object/);
    // No images or embedded raster data.
    expect(Buffer.from(pdf.bytes).toString('latin1')).not.toMatch(/\/Subtype\s*\/Image/);
  });

  it('full sample overflows one page; trimming to the default budget fits on one page', async () => {
    const sel = defaultSelection(SEED_MASTER, emptyJob(), 's1');
    const full = await renderAndInspect(resolveResume(SEED_MASTER, sel));
    expect(full.pageCount).toBeGreaterThan(1);

    const trimmed = trimToBudget(SEED_MASTER, sel, null, DEFAULT_SETTINGS, []);
    expect(trimmed.unresolved).toEqual([]);
    const resolved = resolveResume(SEED_MASTER, trimmed.selection);
    const report = budgetReport(resolved, DEFAULT_SETTINGS);
    const fit = await renderAndInspect(resolved);
    console.log('estimated lines after trim', report.lines, 'pages', fit.pageCount, 'dropped', trimmed.dropped.length);
    expect(fit.pageCount).toBe(1);
  });
});
