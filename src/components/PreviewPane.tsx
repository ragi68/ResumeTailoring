/** Live preview rendered by pdf.js from the exact bytes that get attached, plus the ATS text view. */
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { budgetReport } from '@/lib/budget';
import type { MasterResume, SectionKey, Selection, Settings } from '@/lib/schemas';
import { applyPins, resolveResume } from '@/lib/selection';
import { ActionBar } from './ActionBar';
import { Spinner } from './ui';
import { currentPdf, type PdfState } from './usePdf';

function PdfCanvases({ doc }: { doc: PDFDocumentProxy }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let cancelled = false;
    const render = async () => {
      const width = Math.max(300, host.clientWidth - 16);
      const canvases: HTMLCanvasElement[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.setAttribute('aria-label', `Page ${i} of ${doc.numPages}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        canvases.push(canvas);
      }
      if (!cancelled) host.replaceChildren(...canvases);
    };
    void render();
    const ro = new ResizeObserver(() => void render());
    ro.observe(host);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [doc]);
  return <div ref={ref} className="preview" data-testid="pdf-preview" />;
}

const SECTION_LABEL: Record<SectionKey, string> = { summary: 'Summary', experience: 'Experience', projects: 'Projects', skills: 'Skills', education: 'Education' };

export function FitIndicator(props: { pageCount: number | null; master: MasterResume; sel: Selection; pins: string[]; settings: Settings }) {
  const { pageCount, settings } = props;
  const report = budgetReport(resolveResume(props.master, applyPins(props.sel, props.pins, props.master)), settings);
  const limit = settings.pageLimit;
  const fits = pageCount !== null && pageCount <= limit;
  return (
    <div className="small">
      {pageCount === null ? (
        <span className="muted">Rendering…</span>
      ) : (
        <span className={`fit ${fits ? 'ok' : 'bad'}`} data-testid="fit-indicator">
          {fits ? `✓ Fits on ${limit} page${limit > 1 ? 's' : ''}` : `✗ ${pageCount} pages (limit ${limit})`}
        </span>
      )}
      {report.over.length > 0 && (
        <span className="muted"> · over budget: {report.over.map((k) => `${SECTION_LABEL[k]} ${report.lines[k].toFixed(0)}/${report.budget[k]}`).join(', ')}</span>
      )}
    </div>
  );
}

export function PreviewPane(props: {
  state: PdfState;
  master: MasterResume;
  sel: Selection;
  pins: string[];
  settings: Settings;
  fileName: string;
  onFit: () => void;
  fitting: boolean;
}) {
  const [view, setView] = useState<'pdf' | 'ats'>('pdf');
  const pdf = currentPdf(props.state);
  return (
    <div className="preview-wrap">
      <ActionBar state={props.state} fileName={props.fileName} />
      <div className="row">
        <FitIndicator pageCount={pdf?.inspection.pageCount ?? null} master={props.master} sel={props.sel} pins={props.pins} settings={props.settings} />
        <span className="spacer" />
        <button type="button" onClick={props.onFit} disabled={props.fitting || !pdf} title="Drop lowest-scoring bullets until it fits">
          {props.fitting ? <Spinner /> : null} Fit to {props.settings.pageLimit} page{props.settings.pageLimit > 1 ? 's' : ''}
        </button>
        <div className="row nowrap" role="radiogroup" aria-label="Preview mode">
          <button type="button" className={view === 'pdf' ? 'primary' : ''} aria-pressed={view === 'pdf'} onClick={() => setView('pdf')}>
            PDF
          </button>
          <button type="button" className={view === 'ats' ? 'primary' : ''} aria-pressed={view === 'ats'} onClick={() => setView('ats')} data-testid="ats-toggle">
            ATS text
          </button>
        </div>
      </div>
      {props.state.status === 'error' && <div className="banner error">Could not generate the PDF: {props.state.error}</div>}
      {!pdf ? (
        <p className="muted">
          <Spinner /> Generating PDF…
        </p>
      ) : view === 'pdf' ? (
        <PdfCanvases doc={pdf.doc} />
      ) : (
        <div>
          <p className="muted small">Text extracted from the generated PDF with pdf.js. This is roughly what an applicant tracking system parses.</p>
          <div className="ats-text" data-testid="ats-text">
            {pdf.inspection.pages.map((p, i) => `${i > 0 ? `\n\n──── page ${i + 1} ────\n\n` : ''}${p}`).join('')}
          </div>
        </div>
      )}
    </div>
  );
}
