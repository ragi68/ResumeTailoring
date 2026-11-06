import { useState } from 'react';
import { attachPdfToPage, ensureHostAccess, resolveTarget } from '@/lib/pageBridge';
import { makeTestPdf } from '@/lib/pdf/testPdf';

/** Attach a hardcoded in-memory test PDF to the current page. Used to verify attaching on a new site. */
export function AttachDiagnostics() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setStatus('Working…');
    try {
      const target = await resolveTarget();
      if (!(await ensureHostAccess(target))) {
        setStatus('Access to this site was not granted.');
        return;
      }
      const blob = await makeTestPdf();
      const report = await attachPdfToPage(target, blob, 'attach-test.pdf');
      setStatus(`${report.ok ? 'OK' : 'Failed'} [${report.adapter}${report.method ? `/${report.method}` : ''}]: ${report.detail}`);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="diag">
      <button type="button" data-testid="attach-test-pdf" onClick={() => void run()} disabled={busy}>
        Attach test PDF to current page
      </button>
      <p data-testid="attach-status" className="muted">
        {status}
      </p>
    </div>
  );
}
