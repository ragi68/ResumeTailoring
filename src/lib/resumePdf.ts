/** Browser-side: selection -> in-memory PDF bytes/Blob, plus pdf.js read-back. Never touches disk. */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { inspectPdf, type PdfInspection } from './pdf/inspect';
import { renderPdfBytes } from './pdf/pdfmake';
import { loadPdf } from './pdf/pdfjs';
import { buildResumeDoc } from './pdf/resumeDoc';
import type { MasterResume, Selection } from './schemas';
import { applyPins, resolveResume, resumeToPlainText } from './selection';

export interface GeneratedPdf {
  bytes: Uint8Array<ArrayBuffer>;
  blob: Blob;
  doc: PDFDocumentProxy;
  inspection: PdfInspection;
  plainText: string;
}

export async function generateResumePdf(master: MasterResume, sel: Selection, pins: readonly string[]): Promise<GeneratedPdf> {
  const resolved = resolveResume(master, applyPins(sel, pins, master));
  const bytes = await renderPdfBytes(buildResumeDoc(resolved));
  const doc = await loadPdf(bytes);
  const inspection = await inspectPdf(doc);
  return { bytes, blob: new Blob([bytes], { type: 'application/pdf' }), doc, inspection, plainText: resumeToPlainText(resolved) };
}

export async function countPdfPages(master: MasterResume, sel: Selection, pins: readonly string[]): Promise<number> {
  const resolved = resolveResume(master, applyPins(sel, pins, master));
  const doc = await loadPdf(await renderPdfBytes(buildResumeDoc(resolved)));
  const n = doc.numPages;
  await doc.destroy();
  return n;
}
