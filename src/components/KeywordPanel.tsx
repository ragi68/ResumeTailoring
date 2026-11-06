/** Keyword coverage chips (covered / suggested / missing) with truthful fixes, plus rewrite suggestions. */
import { useMemo, useState } from 'react';
import { analyzeKeywordGaps, type KeywordStatus, type KeywordSuggestion } from '@/lib/keywords';
import type { Selection } from '@/lib/schemas';
import { applyPins } from '@/lib/selection';
import { useApp } from '@/lib/store';
import { RewritePanel } from './RewritePanel';

const PRIORITY_LABEL = { required: 'Required', nice: 'Nice to have', keyword: 'Other keywords' } as const;

function applySuggestion(d: Selection, s: KeywordSuggestion) {
  if (s.kind === 'add-skill') {
    if (!d.skillIds.includes(s.skillId)) d.skillIds.push(s.skillId);
    return;
  }
  const block = d.blocks.find((b) => b.refId === s.blockId);
  if (!block) return;
  block.included = true;
  const ref = block.bullets.find((r) => r.id === s.bulletId);
  if (ref) ref.included = true;
  if (s.kind === 'use-alternate') d.textOverrides[s.bulletId] = s.alternate;
}

function KeywordDetail({ k, sel }: { k: KeywordStatus; sel: Selection }) {
  const mutate = useApp((s) => s.mutateSelection);
  return (
    <div className="card soft small" data-testid="keyword-detail">
      <b>{k.keyword}</b> <span className="muted">({PRIORITY_LABEL[k.priority]})</span>
      {k.status === 'covered' && (
        <ul>
          {k.coveredBy.slice(0, 5).map((c, i) => (
            <li key={i}>Covered by: {c}</li>
          ))}
        </ul>
      )}
      {k.status === 'suggested' && (
        <ul>
          {k.suggestions.slice(0, 4).map((s, i) => (
            <li key={i}>
              {s.label}{' '}
              <button type="button" className="link" onClick={() => mutate(sel.id, (d) => applySuggestion(d, s))}>
                Apply
              </button>
            </li>
          ))}
        </ul>
      )}
      {k.status === 'missing' && (
        <p>
          No supported place: nothing in your master resume mentions this. If you do have this experience, add it to the master first.
        </p>
      )}
    </div>
  );
}

export function KeywordPanel({ sel }: { sel: Selection }) {
  const master = useApp((s) => s.master);
  const pins = useApp((s) => s.pins);
  const [active, setActive] = useState<string | null>(null);
  const analysis = sel.job.analysis;
  const statuses = useMemo(() => (analysis ? analyzeKeywordGaps(master, applyPins(sel, pins, master), analysis) : []), [master, sel, pins, analysis]);

  if (!analysis) return <p className="muted">Analyze the job description on the Tailor tab to see keyword coverage.</p>;

  const covered = statuses.filter((s) => s.status === 'covered').length;
  const activeStatus = statuses.find((s) => s.keyword === active) ?? null;
  return (
    <div>
      <p>
        <b>
          {covered} of {statuses.length}
        </b>{' '}
        job keywords appear in this resume.{' '}
        <span className="chip covered">covered</span>
        <span className="chip suggested">can be covered truthfully</span>
        <span className="chip missing">no supported place</span>
      </p>
      <div data-testid="keyword-chips">
        {(['required', 'nice', 'keyword'] as const).map((p) => {
          const group = statuses.filter((s) => s.priority === p);
          if (!group.length) return null;
          return (
            <div key={p}>
              <h3>{PRIORITY_LABEL[p]}</h3>
              {group.map((k) => (
                <button
                  type="button"
                  key={k.keyword}
                  className={`chip ${k.status}${active === k.keyword ? ' active' : ''}`}
                  aria-pressed={active === k.keyword}
                  title={k.status === 'covered' ? 'Covered' : k.status === 'suggested' ? 'Click for a truthful way to cover it' : 'No supported place in your master resume'}
                  onClick={() => setActive(active === k.keyword ? null : k.keyword)}
                >
                  {k.status === 'covered' ? '✓ ' : k.status === 'suggested' ? '+ ' : '✗ '}
                  {k.keyword}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {activeStatus && <KeywordDetail k={activeStatus} sel={sel} />}
      <RewritePanel sel={sel} />
    </div>
  );
}
