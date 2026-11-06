/** Tailor tab: job description capture (page / selection / paste) and the tailoring pipeline. */
import { useEffect, useState } from 'react';
import type { CaptureMode } from '@/lib/adapters/capture';
import { sendToBackground } from '@/lib/messaging';
import { captureJdFromPage, describeTarget, ensureHostAccess, resolveTarget } from '@/lib/pageBridge';
import type { JdAnalysis, Selection } from '@/lib/schemas';
import { applyPlan } from '@/lib/selection';
import { API_KEY_STORAGE_KEY, getApiKey } from '@/lib/storage';
import { useApp } from '@/lib/store';
import { Spinner, TextArea, TextField } from './ui';

const SOURCE_LABEL: Record<Selection['job']['jdSource'], string> = {
  'json-ld': 'structured data (JSON-LD)',
  site: 'page content',
  selection: 'your selected text',
  manual: 'pasted / typed',
};

type Msg = { kind: 'ok' | 'warn' | 'error' | 'info'; text: string } | null;

type Step = 'idle' | 'analyzing' | 'selecting' | 'done' | 'error';

function AnalysisSummary({ analysis }: { analysis: JdAnalysis }) {
  return (
    <div className="card soft small" data-testid="analysis">
      <div>
        <b>{analysis.title || 'Role'}</b>
        {analysis.company && ` at ${analysis.company}`} · {analysis.seniority} · {analysis.domain}
      </div>
      {analysis.requiredSkills.length > 0 && (
        <div>
          <span className="muted">Required: </span>
          {analysis.requiredSkills.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </div>
      )}
      {analysis.niceToHaves.length > 0 && (
        <div>
          <span className="muted">Nice to have: </span>
          {analysis.niceToHaves.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TailorSection({ sel, onTailored, goTo }: { sel: Selection; onTailored: () => void; goTo: (tab: 'edit' | 'keywords') => void }) {
  const mutate = useApp((s) => s.mutateSelection);
  const upsert = useApp((s) => s.upsertSelection);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    void getApiKey().then((k) => setHasKey(k !== ''));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[API_KEY_STORAGE_KEY]) setHasKey(Boolean(changes[API_KEY_STORAGE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  async function tailor(forceAnalyze: boolean) {
    setError(null);
    try {
      let current = useApp.getState().selections[sel.id];
      if (!current) return;
      let analysis = current.job.analysis;
      if (!analysis || forceAnalyze) {
        setStep('analyzing');
        const a = await sendToBackground('LLM_ANALYZE', { jdText: current.job.jdText, title: current.job.title, company: current.job.company });
        analysis = a;
        mutate(sel.id, (d) => {
          d.job.analysis = a;
          if (!d.job.title) d.job.title = a.title;
          if (!d.job.company) d.job.company = a.company;
        });
      }
      setStep('selecting');
      const { master, pins, settings } = useApp.getState();
      const res = await sendToBackground('LLM_SELECT', { analysis, master, pins, lineBudget: settings.lineBudget, pageLimit: settings.pageLimit });
      current = useApp.getState().selections[sel.id];
      if (!current) return;
      const next = applyPlan(master, res.plan, pins, current);
      upsert({ ...next, notes: [res.rationale, ...res.issues].filter(Boolean) });
      setStep('done');
      onTailored();
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const running = step === 'analyzing' || step === 'selecting';
  const canRun = sel.job.jdText.trim().length >= 50 && hasKey === true && !running;
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="row">
        <button type="button" className="primary" disabled={!canRun} onClick={() => void tailor(false)} data-testid="tailor">
          {running ? <Spinner /> : null} {sel.origin === 'llm' ? 'Re-tailor' : 'Analyze & tailor'}
        </button>
        {sel.job.analysis && (
          <button type="button" disabled={!canRun} onClick={() => void tailor(true)} title="Run the job description analysis again">
            Re-analyze JD
          </button>
        )}
        <span className="muted small" role="status" data-testid="tailor-step">
          {step === 'analyzing' && 'Analyzing the job description…'}
          {step === 'selecting' && 'Selecting and ordering your content…'}
          {step === 'done' && 'Tailored. Review it on the Edit and Keywords tabs.'}
        </span>
      </div>
      {hasKey === false && (
        <div className="banner warn">
          Add your Anthropic API key in{' '}
          <button type="button" className="link" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#settings') })}>
            Settings
          </button>{' '}
          to tailor automatically. You can still edit the selection by hand.
        </div>
      )}
      {sel.job.jdText.trim().length < 50 && hasKey && <p className="muted small">Capture or paste the job description first.</p>}
      {error && (
        <div className="banner error" role="alert" data-testid="tailor-error">
          {error}
        </div>
      )}
      {sel.job.analysis && <AnalysisSummary analysis={sel.job.analysis} />}
      {sel.origin === 'llm' && sel.notes.length > 0 && (
        <details className="small">
          <summary>Notes from tailoring ({sel.notes.length})</summary>
          <ul>
            {sel.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {step === 'done' && (
        <div className="row small">
          <button type="button" className="link" onClick={() => goTo('edit')}>
            Review selection →
          </button>
          <button type="button" className="link" onClick={() => goTo('keywords')}>
            Keyword gaps →
          </button>
        </div>
      )}
    </div>
  );
}

export function JobPanel({ sel, onTailored, goTo }: { sel: Selection; onTailored: () => void; goTo: (tab: 'edit' | 'keywords') => void }) {
  const mutate = useApp((s) => s.mutateSelection);
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function capture(mode: CaptureMode) {
    setBusy(mode);
    setMsg(null);
    try {
      const target = await resolveTarget();
      if (!(await ensureHostAccess(target))) {
        setMsg({ kind: 'error', text: `Access to ${describeTarget(target)} was not granted. Paste the description instead.` });
        return;
      }
      const jd = await captureJdFromPage(target, mode);
      if (!jd) {
        setMsg({
          kind: 'warn',
          text:
            mode === 'selection'
              ? 'No text is selected on the page. Highlight the job description first.'
              : 'No job description found on this page. Highlight it and use "Use selected text", or paste it below.',
        });
        return;
      }
      mutate(sel.id, (d) => {
        d.job = {
          ...d.job,
          title: jd.title || d.job.title,
          company: jd.company || d.job.company,
          url: jd.url,
          jdText: jd.text,
          jdSource: jd.source,
          capturedAt: Date.now(),
          analysis: null, // the old analysis no longer matches
        };
      });
      setMsg({ kind: 'ok', text: `Captured ${jd.text.length.toLocaleString()} characters from ${SOURCE_LABEL[jd.source]}.` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row">
        <button type="button" className="primary" onClick={() => void capture('auto')} disabled={busy !== null} data-testid="capture-jd">
          {busy === 'auto' ? <Spinner /> : null} Capture from page
        </button>
        <button type="button" onClick={() => void capture('selection')} disabled={busy !== null} data-testid="capture-selection">
          {busy === 'selection' ? <Spinner /> : null} Use selected text
        </button>
      </div>
      {msg && (
        <div className={`banner ${msg.kind}`} role="status" data-testid="capture-status">
          {msg.text}
        </div>
      )}
      <div className="grid2">
        <TextField label="Job title" value={sel.job.title} onChange={(v) => mutate(sel.id, (d) => void (d.job.title = v))} testId="job-title" />
        <TextField label="Company" value={sel.job.company} onChange={(v) => mutate(sel.id, (d) => void (d.job.company = v))} testId="job-company" />
      </div>
      <TextArea
        label={`Job description${sel.job.jdText ? ` (from ${SOURCE_LABEL[sel.job.jdSource]})` : ''}`}
        rows={10}
        value={sel.job.jdText}
        placeholder="Paste the job description here, or capture it from the page"
        onChange={(v) =>
          mutate(sel.id, (d) => {
            d.job.jdText = v;
            d.job.jdSource = 'manual';
            d.job.analysis = null; // stale once the text changes
          })
        }
      />
      {sel.job.url && (
        <p className="muted small">
          Source: <a href={sel.job.url} target="_blank" rel="noreferrer">{sel.job.url.slice(0, 80)}</a>
        </p>
      )}
      <TailorSection sel={sel} onTailored={onTailored} goTo={goTo} />
    </div>
  );
}
