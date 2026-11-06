/** pdfmake wrapper: builds text-based PDFs entirely in memory with the embedded Roboto font. */
import * as pdfMakeNs from 'pdfmake/build/pdfmake';
import vfs from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// The UMD bundle exports a class instance; its methods need the instance as `this`,
// so use the CommonJS default export rather than the namespace wrapper.
const pdfMake = (pdfMakeNs as unknown as { default?: typeof pdfMakeNs }).default ?? pdfMakeNs;

let fontsReady = false;

function ensureFonts(): void {
  if (fontsReady) return;
  pdfMake.addVirtualFileSystem(vfs);
  // Never fetch remote resources while rendering.
  pdfMake.setUrlAccessPolicy(() => false);
  fontsReady = true;
}

export async function renderPdfBytes(doc: TDocumentDefinitions): Promise<Uint8Array<ArrayBuffer>> {
  ensureFonts();
  const buffer = (await pdfMake.createPdf(doc).getBuffer()) as unknown as Uint8Array;
  // Copy into a fresh ArrayBuffer-backed array so it can be handed to Blob/File constructors.
  return new Uint8Array(buffer);
}

export async function renderPdfBlob(doc: TDocumentDefinitions): Promise<Blob> {
  return new Blob([await renderPdfBytes(doc)], { type: 'application/pdf' });
}
