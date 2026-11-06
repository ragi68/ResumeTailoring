/** Read back a generated PDF with pdf.js: page count and the text a parser would extract. */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface PdfInspection {
  pageCount: number;
  pages: string[];
}

interface TextItemLike {
  str: string;
  hasEOL: boolean;
}

function isTextItem(item: unknown): item is TextItemLike {
  return typeof item === 'object' && item !== null && 'str' in item && 'hasEOL' in item;
}

export async function inspectPdf(doc: PDFDocumentProxy): Promise<PdfInspection> {
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = '';
    for (const item of tc.items) {
      if (!isTextItem(item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').trim());
  }
  return { pageCount: doc.numPages, pages };
}
