/**
 * Attach to application (primary), plus fallbacks: drag the file out, copy text, manual download.
 * Nothing is written to disk unless the user clicks Download or drags the file somewhere.
 */
import { useEffect, useMemo, useState } from 'react';
import { attachPdfToPage, describeTarget, ensureHostAccess, resolveTarget } from '@/lib/pageBridge';
import { Spinner } from './ui';
import { currentPdf, type PdfState } from './usePdf';

type Status = { kind: 'ok' | 'warn' | 'error' | 'info'; text: string } | null;

export function ActionBar({ state, fileName }: { state: PdfState; fileName: string }) {
  const pdf = currentPdf(state);
  const ready = state.status === 'ready';
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const blobUrl = useMemo(() => (pdf ? URL.createObjectURL(pdf.blob) : null), [pdf]);
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  async function attach() {
    if (!pdf) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'Attaching…' });
    try {
      const target = await resolveTarget();
      if (!(await ensureHostAccess(target))) {
        setStatus({ kind: 'error', text: `Access to ${describeTarget(target)} was not granted. Use the fallbacks below.` });
        return;
      }
      const report = await attachPdfToPage(target, pdf.blob, fileName);
      if (!report.ok) setStatus({ kind: 'error', text: `${report.detail}. Try the fallbacks below.` });
      else setStatus({ kind: report.verified ? 'ok' : 'warn', text: `${report.detail}. Review the form before submitting.` });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    if (!pdf) return;
    try {
      await navigator.clipboard.writeText(pdf.plainText);
      setStatus({ kind: 'ok', text: 'Resume text copied to the clipboard.' });
    } catch (e) {
      setStatus({ kind: 'error', text: `Copy failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  function download() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.click();
  }

  return (
    <div>
      <div className="action-bar">
        <button type="button" className="primary" onClick={() => void attach()} disabled={!ready || busy} data-testid="attach-resume">
          {busy ? <Spinner /> : null} Attach to application
        </button>
        <span
          className="drag-chip small"
          draggable={!!pdf}
          title="Drag onto the page's upload area or your desktop"
          onDragStart={(e) => {
            if (!pdf || !blobUrl) return;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('DownloadURL', `application/pdf:${fileName}:${blobUrl}`);
            try {
              e.dataTransfer.items.add(new File([pdf.blob], fileName, { type: 'application/pdf' }));
            } catch {
              /* some targets only accept DownloadURL */
            }
          }}
        >
          ⇲ Drag file
        </span>
        <button type="button" onClick={() => void copyText()} disabled={!pdf}>
          Copy text
        </button>
        <button type="button" onClick={download} disabled={!pdf}>
          Download
        </button>
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>
        {fileName}
      </p>
      {status && (
        <div className={`banner ${status.kind}`} role="status" data-testid="attach-result">
          {status.text}
        </div>
      )}
    </div>
  );
}
