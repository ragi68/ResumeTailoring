import { it } from 'vitest';
import { estimateLines, dropLowestBullet } from '@/lib/budget';
import { SEED_MASTER } from '@/lib/seed';
import { defaultSelection, emptyJob, resolveResume } from '@/lib/selection';
import { renderAndInspect } from './helpers/pdf';

it.skipIf(!process.env.CALIBRATE)('calibrate: estimated lines vs real pages', async () => {
  const sel = defaultSelection(SEED_MASTER, emptyJob(), 's');
  for (let i = 0; i < 20; i++) {
    const r = resolveResume(SEED_MASTER, sel);
    const est = estimateLines(r).total;
    const pdf = await renderAndInspect(r);
    const lastPageLines = pdf.pages[pdf.pages.length - 1]!.split('\n').length;
    console.log(`est=${est.toFixed(1)} pages=${pdf.pageCount} lastPageLines=${lastPageLines}`);
    if (!dropLowestBullet(SEED_MASTER, sel, null, new Set())) break;
  }
}, 60000);
