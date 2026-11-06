/** Small form primitives used by the editors. */
import { useEffect, useState, type ReactNode } from 'react';

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'email' | 'url' | 'password';
  testId?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea rows={props.rows ?? 3} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

/** Comma-separated list input that commits on blur so typing a comma doesn't fight the cursor. */
export function ListInput(props: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const joined = props.values.join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const commit = () => {
    const next = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (next.join(', ') !== joined) props.onChange(next);
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input type="text" value={text} placeholder={props.placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    </label>
  );
}

/** Up / down / delete controls for an item in a list. */
export function ItemControls(props: { index: number; count: number; onMove: (from: number, to: number) => void; onDelete: () => void; label: string }) {
  const { index, count, onMove, onDelete, label } = props;
  return (
    <span className="row nowrap">
      <button type="button" className="icon" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
        ↑
      </button>
      <button type="button" className="icon" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
        ↓
      </button>
      <button
        type="button"
        className="icon danger"
        aria-label={`Delete ${label}`}
        onClick={() => {
          if (confirm(`Delete ${label}?`)) onDelete();
        }}
      >
        ✕
      </button>
    </span>
  );
}

export function Section(props: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={props.open}>
      <summary>{props.title}</summary>
      <div className="body">{props.children}</div>
    </details>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function moveItem<T>(arr: T[], from: number, to: number): void {
  if (to < 0 || to >= arr.length || from === to) return;
  const [item] = arr.splice(from, 1);
  if (item !== undefined) arr.splice(to, 0, item);
}
