/** The tailoring app. Runs in the side panel (narrow) and in a full tab via "Expand" (wide). */
import { useEffect, useMemo, useState } from 'react';
import { fitToPageLimit } from '@/lib/fit';
import { DEFAULT_SETTINGS } from '@/lib/schemas';
import { countPdfPages } from '@/lib/resumePdf';
import { defaultSelection, emptyJob } from '@/lib/selection';
import { startStore, useApp } from '@/lib/store';
import { fileNameFromPattern, newId } from '@/lib/text';
import { BlockEditor } from './BlockEditor';
import { JobPanel } from './JobPanel';
import { KeywordPanel } from './KeywordPanel';
import { LoadErrors } from './LoadErrors';
import { PreviewPane } from './PreviewPane';
import { usePdf } from './usePdf';

type Tab = 'tailor' | 'edit' | 'keywords' | 'preview';

function JobPicker() {
  const selections = useApp((s) => s.selections);
  const activeId = useApp((s) => s.activeSelectionId);
  const setActive = useApp((s) => s.setActiveSelection);
  const del = useApp((s) => s.deleteSelection);
  const list = Object.values(selections).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="row nowrap grow">
      <select className="grow" aria-label="Saved jobs" value={activeId ?? ''} onChange={(e) => setActive(e.target.value || null)} data-testid="job-picker">
        <option value="">{list.length ? 'Choose a saved job…' : 'No saved jobs yet'}</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {[s.job.title || 'Untitled job', s.job.company].filter(Boolean).join(' – ')} ({new Date(s.updatedAt).toLocaleDateString()})
          </option>
        ))}
      </select>
      {activeId && (
        <button
          type="button"
          className="icon danger"
          aria-label="Delete this saved job"
          title="Delete this saved job"
          onClick={() => {
            if (confirm('Delete this saved job and its tailoring?')) del(activeId);
          }}
        >
          🗑
        </button>
      )}
    </div>
  );
}

export function App({ wide }: { wide: boolean }) {
  const hydrated = useApp((s) => s.hydrated);
  const master = useApp((s) => s.master);
  const settings = useApp((s) => s.settings);
  const pins = useApp((s) => s.pins);
  const activeId = useApp((s) => s.activeSelectionId);
  const sel = useApp((s) => (s.activeSelectionId ? (s.selections[s.activeSelectionId] ?? null) : null));
  const upsert = useApp((s) => s.upsertSelection);
  const setActive = useApp((s) => s.setActiveSelection);
  const [tab, setTab] = useState<Tab>('tailor');
  const [fitting, setFitting] = useState(false);
  const [fitMsg, setFitMsg] = useState<string | null>(null);

  useEffect(() => {
    void startStore();
  }, []);

  // Only re-render the PDF when something that appears in it changes (not e.g. JD text edits).
  const renderKey = sel ? JSON.stringify([sel.id, sel.summaryId, sel.blocks, sel.skillIds, sel.textOverrides]) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const renderSel = useMemo(() => sel, [renderKey]);
  const pdfState = usePdf(master, renderSel, pins);
  const fileName = useMemo(
    () => fileNameFromPattern(settings.fileNamePattern || DEFAULT_SETTINGS.fileNamePattern, { name: master.header.name, company: sel?.job.company ?? '', title: sel?.job.title ?? '' }),
    [settings.fileNamePattern, master.header.name, sel?.job.company, sel?.job.title],
  );

  function newJob() {
    const id = newId('job');
    upsert(defaultSelection(master, emptyJob(), id));
    setActive(id);
    setTab('tailor');
  }

  async function fit() {
    // Read from the store, not the render closure: this also runs right after tailoring replaced the selection.
    const { master, settings, pins, selections, activeSelectionId } = useApp.getState();
    const current = activeSelectionId ? selections[activeSelectionId] : undefined;
    if (!current) return;
    setFitting(true);
    setFitMsg(null);
    try {
      const r = await fitToPageLimit(master, current, current.job.analysis, settings, pins, (s) => countPdfPages(master, s, pins));
      upsert({ ...r.selection, updatedAt: Date.now() });
      setFitMsg(
        r.fits
          ? `Fits on ${r.pageCount} page${r.pageCount > 1 ? 's' : ''}${r.dropped.length ? `; removed ${r.dropped.length} lowest-scoring item(s)` : ''}.`
          : `Still ${r.pageCount} pages: everything left is pinned or the last bullet of its role. Unpin or exclude items, or allow 2 pages.`,
      );
    } catch (e) {
      setFitMsg(`Fit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFitting(false);
    }
  }

  if (!hydrated) return <p className="muted" style={{ padding: 12 }}>Loading…</p>;

  const leftTabs: [Tab, string][] = [
    ['tailor', 'Tailor'],
    ['edit', 'Edit'],
    ['keywords', 'Keywords'],
  ];
  if (!wide) leftTabs.push(['preview', 'Preview']);
  const activeTab = wide && tab === 'preview' ? 'tailor' : tab;

  const preview = sel ? (
    <div>
      <PreviewPane state={pdfState} master={master} sel={sel} pins={pins} settings={settings} fileName={fileName} onFit={() => void fit()} fitting={fitting} />
      {fitMsg && <div className="banner info small">{fitMsg}</div>}
    </div>
  ) : null;

  return (
    <div className={`app${wide ? ' wide' : ''}`}>
      <div className="header-bar">
        <h1 title="Resume Tailor">RT</h1>
        <JobPicker />
        <button type="button" onClick={newJob} title="Start tailoring for a new job" data-testid="new-job">
          + New
        </button>
        {!wide && (
          <button
            type="button"
            title="Open in a full tab (stays in sync with the side panel)"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/sidepanel.html?view=tab') })}
          >
            ⤢ Expand
          </button>
        )}
        <button type="button" className="icon" title="Master resume & settings" aria-label="Master resume and settings" onClick={() => void chrome.runtime.openOptionsPage()}>
          ⚙
        </button>
      </div>
      <LoadErrors />
      {!sel ? (
        <div className="workspace">
          <div className="card soft">
            <h2>Tailor your resume to a job</h2>
            <p>Open a job posting or application page, then start a new job. The panel captures the job description, tailors your master resume to it, and attaches the PDF to the application's upload field.</p>
            <button type="button" className="primary" onClick={newJob}>
              + New job
            </button>
            <p className="muted small" style={{ marginTop: 8 }}>
              Tip: drag the side panel's left edge to make it wider, or use ⤢ Expand to work in a full tab next to the live preview.
            </p>
            <p className="muted small">
              Your master resume is edited in <button type="button" className="link" onClick={() => void chrome.runtime.openOptionsPage()}>settings</button>. A sample resume is loaded so you can try it right away.
            </p>
          </div>
        </div>
      ) : (
        <div className="workspace">
          <div>
            <div className="tabs" role="tablist">
              {leftTabs.map(([t, label]) => (
                <button key={t} type="button" role="tab" aria-selected={activeTab === t} className={activeTab === t ? 'active' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
                  {label}
                </button>
              ))}
            </div>
            {activeTab === 'tailor' && <JobPanel key={activeId} sel={sel} onTailored={() => (settings.autoFit ? void fit() : undefined)} goTo={setTab} />}
            {activeTab === 'edit' && <BlockEditor sel={sel} />}
            {activeTab === 'keywords' && <KeywordPanel sel={sel} />}
            {activeTab === 'preview' && preview}
          </div>
          {wide && preview}
        </div>
      )}
    </div>
  );
}
