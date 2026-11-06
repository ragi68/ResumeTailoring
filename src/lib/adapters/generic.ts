import { attachToTarget, bestFileInput, findDropZone, findFileInputs, waitFor } from './dom';
import type { FindOptions, SiteAdapter, UploadTarget } from './types';

/** Finds a target anywhere: best-scoring file input (visible or hidden), else a drop zone. */
export function genericFindTarget(doc: Document): UploadTarget | null {
  return bestFileInput(findFileInputs(doc)) ?? findDropZone(doc);
}

export const genericAdapter: SiteAdapter = {
  name: 'generic',
  getJobDescription() {
    return null; // Generic pages rely on JSON-LD, selected text, or manual paste.
  },
  async findUploadTarget(doc: Document, opts?: FindOptions) {
    return waitFor(doc, () => genericFindTarget(doc), opts?.waitMs ?? 0);
  },
  async attachFile(file: File, doc: Document, opts?: FindOptions) {
    const target = await genericAdapter.findUploadTarget(doc, opts);
    if (!target) {
      return { ok: false, adapter: 'generic', verified: false, detail: 'No file input or upload zone found in this frame' };
    }
    return attachToTarget(target, file, 'generic');
  },
};
