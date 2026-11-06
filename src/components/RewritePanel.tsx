/** Optional rewrite suggestions, shown as word diffs the user accepts or rejects one by one. */
import { useState } from 'react';
import type { RewriteResult } from '@/lib/llm/pipeline';
import { wordDiff } from '@/lib/llm/rewriteGuard';
import { sendToBackground } from '@/lib/messaging';
import type { Selection } from '@/lib/schemas';
import { applyPins, indexMaster } from '@/lib/selection';
import { useApp } from '@/lib/store';
import { Spinner } from './ui';

function Diff({ a, b }: { a: string; b: string }) {
  return (
    <p className="diff">
      {wordDiff(a, b).map((p, i) => (p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'del' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
    </p>
  );
}

export function RewritePanel({ sel }: { sel: Selection }) {
  const mutate = useApp((s) => s.mutateSelection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [decided, setDecided] = useState<Record<string, 'accepted' | 'rejected'>>({});

  async function suggest() {
    const { master, pins } = useApp.getState();
    const current = useApp.getState().selections[sel.id];
    if (!current?.job.analysis) return;
    setBusy(true);
    setError(null);
    try {
      const idx = indexMaster(master);
      const effective = applyPins(current, pins, master);
      // Included bullets without an accepted rewrite, original master text only.
      const bullets = effective.blocks
        .filter((b) => b.included)
        .flatMap((b) => b.bullets.filter((r) => r.included && current.textOverrides[r.id] === undefined))
        .map((r) => ({ id: r.id, text: idx.bullets.get(r.id)?.text ?? '' }))
        .filter((b) => b.text);
      setResult(await sendToBackground('LLM_REWRITE', { analysis: current.job.analysis, master, bullets }));
      setDecided({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pending = result?.suggestions.filter((s) => !decided[s.bulletId]) ?? [];
  return (
    <section>
      <h2>Wording suggestions</h2>
      <p className="muted small">
        Optional. The model may only rephrase a bullet you already have, e.g. to use the posting's term for the same thing. Suggestions that add numbers, tools or claims are discarded automatically.
      </p>
      <button type="button" onClick={() => void suggest()} disabled={busy || !sel.job.analysis} data-testid="suggest-rewrites">
        {busy ? <Spinner /> : null} Suggest rewrites
      </button>
      {error && <div className="banner error">{error}</div>}
      {result && result.suggestions.length === 0 && <p className="muted">No honest improvements found. Your bullets already fit.</p>}
      {pending.map((s) => (
        <div key={s.bulletId} className="card" data-testid="rewrite-card">
          <Diff a={s.original} b={s.text} />
          <p className="muted small">{s.reason}</p>
          <div className="row">
            <button
              type="button"
              className="primary"
              data-testid="rewrite-accept"
              onClick={() => {
                mutate(sel.id, (d) => void (d.textOverrides[s.bulletId] = s.text));
                setDecided((x) => ({ ...x, [s.bulletId]: 'accepted' }));
              }}
            >
              Accept
            </button>
            <button type="button" data-testid="rewrite-reject" onClick={() => setDecided((x) => ({ ...x, [s.bulletId]: 'rejected' }))}>
              Reject
            </button>
          </div>
        </div>
      ))}
      {result && Object.values(decided).some((v) => v === 'accepted') && (
        <p className="muted small">Accepted rewrites apply only to this job. Revert any of them from the Edit tab.</p>
      )}
      {result && result.rejected.length > 0 && (
        <details className="small">
          <summary>{result.rejected.length} suggestion(s) discarded by the honesty check</summary>
          <ul>
            {result.rejected.map((r) => (
              <li key={r.bulletId}>
                <i>{r.text}</i>: {r.problems.join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
