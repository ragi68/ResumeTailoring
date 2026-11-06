/**
 * Fit to the page limit: first trim by line budget (cheap estimate), then confirm with the real
 * PDF page count and keep dropping the lowest-scoring bullet until it fits.
 */
import { trimOneMore, trimToBudget } from './budget';
import type { JdAnalysis, MasterResume, Selection, Settings } from './schemas';
import { applyPins } from './selection';

export interface FitResult {
  selection: Selection;
  dropped: string[];
  pageCount: number;
  fits: boolean;
}

export async function fitToPageLimit(
  master: MasterResume,
  selection: Selection,
  analysis: JdAnalysis | null,
  settings: Pick<Settings, 'lineBudget' | 'pageLimit'>,
  pins: readonly string[],
  countPages: (sel: Selection) => Promise<number>,
  maxSteps = 40,
): Promise<FitResult> {
  const budgeted = trimToBudget(master, applyPins(selection, pins, master), analysis, settings, pins);
  let sel = budgeted.selection;
  const dropped = [...budgeted.dropped];
  let pages = await countPages(sel);
  for (let i = 0; i < maxSteps && pages > settings.pageLimit; i++) {
    const next = trimOneMore(master, sel, analysis, pins);
    if (!next.dropped) break;
    sel = next.selection;
    dropped.push(next.dropped);
    pages = await countPages(sel);
  }
  return { selection: sel, dropped, pageCount: pages, fits: pages <= settings.pageLimit };
}
