/** Hardcoded one-page test PDF used by the attach spike / diagnostics. */
import { renderPdfBlob } from './pdfmake';

export function makeTestPdf(): Promise<Blob> {
  return renderPdfBlob({
    info: { title: 'Resume Tailor attach test' },
    defaultStyle: { font: 'Roboto', fontSize: 11 },
    content: [
      { text: 'Resume Tailor attach test', fontSize: 16, bold: true },
      { text: `Generated in memory at ${new Date().toISOString()}` },
      { text: 'If you can read this in the job application, attaching works.' },
    ],
  });
}
