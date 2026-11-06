/** Node-side PDF helpers for tests: pdfmake to bytes, pdf.js (legacy build) to read back. */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { inspectPdf, type PdfInspection } from '@/lib/pdf/inspect';
import { renderPdfBytes } from '@/lib/pdf/pdfmake';
import { buildResumeDoc } from '@/lib/pdf/resumeDoc';
import type { ResolvedResume } from '@/lib/selection';

export async function renderAndInspect(r: ResolvedResume): Promise<PdfInspection & { bytes: Uint8Array }> {
  const bytes = await renderPdfBytes(buildResumeDoc(r));
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const result = await inspectPdf(doc as unknown as Parameters<typeof inspectPdf>[0]);
  await doc.destroy();
  return { ...result, bytes };
}
