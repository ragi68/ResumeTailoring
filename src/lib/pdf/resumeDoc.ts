/**
 * ATS-friendly resume layout for pdfmake:
 * - real text (no images, no canvas/vector graphics, no tables, no text boxes)
 * - single column, standard headings, one date format, plain "•" bullets as text characters
 * - embedded Roboto font
 */
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ResolvedEntry, ResolvedResume } from '../selection';

export const PDF_LAYOUT = {
  pageSize: 'LETTER' as const,
  margins: [43, 38, 43, 38] as [number, number, number, number], // ~0.6in sides, ~0.53in top/bottom
  fontSize: 10,
  lineHeight: 1.12,
};

function heading(text: string): Content {
  return { text, style: 'heading', margin: [0, 8, 0, 3] };
}

/** A bullet is two text columns on one baseline: the "•" character and the wrapped text. */
function bullet(text: string): Content {
  return {
    columns: [
      { text: '•', width: 9 },
      { text, width: '*' },
    ],
    columnGap: 0,
    margin: [6, 0, 0, 1.5],
  };
}

function entry(e: ResolvedEntry): Content[] {
  const out: Content[] = [];
  const titleParts: Content[] = [{ text: e.title, bold: true }];
  if (e.org) titleParts.push({ text: `, ${e.org}` });
  if (e.links.length) titleParts.push({ text: ` | ${e.links.join(' | ')}`, style: 'meta' });
  out.push({ text: titleParts, margin: [0, 4, 0, 0] });
  const meta = [e.location, e.dates].filter(Boolean).join(' | ');
  if (meta) out.push({ text: meta, style: 'meta', margin: [0, 0, 0, 1] });
  if (e.details) out.push({ text: e.details, margin: [0, 0, 0, 1] });
  for (const b of e.bullets) out.push(bullet(b.text));
  return out;
}

export function buildResumeDoc(r: ResolvedResume): TDocumentDefinitions {
  const h = r.header;
  const contact = [h.location, h.email, h.phone, ...h.links.map((l) => l.label || l.url)].filter(Boolean).join(' | ');
  const content: Content[] = [
    { text: h.name, style: 'name' },
    { text: contact, style: 'contact' },
  ];
  if (r.summary) content.push(heading('Summary'), { text: r.summary });
  if (r.experience.length) content.push(heading('Experience'), ...r.experience.flatMap(entry));
  if (r.projects.length) content.push(heading('Projects'), ...r.projects.flatMap(entry));
  if (r.skills.length) {
    content.push(
      heading('Skills'),
      ...r.skills.map((g): Content => ({ text: [{ text: `${g.group}: `, bold: true }, { text: g.names.join(', ') }], margin: [0, 0, 0, 1] })),
    );
  }
  if (r.education.length) content.push(heading('Education'), ...r.education.flatMap(entry));

  return {
    pageSize: PDF_LAYOUT.pageSize,
    pageMargins: PDF_LAYOUT.margins,
    info: {
      title: `${h.name} Resume`,
      author: h.name,
      subject: 'Resume',
      creator: 'Resume Tailor',
    },
    defaultStyle: { font: 'Roboto', fontSize: PDF_LAYOUT.fontSize, lineHeight: PDF_LAYOUT.lineHeight },
    styles: {
      name: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      contact: { fontSize: 9.5 },
      heading: { fontSize: 11.5, bold: true },
      meta: { fontSize: 9.5, italics: true },
    },
    content,
  };
}
