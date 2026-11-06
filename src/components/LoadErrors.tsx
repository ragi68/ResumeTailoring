import { useApp } from '@/lib/store';

export function LoadErrors() {
  const errors = useApp((s) => s.loadErrors);
  const dismiss = useApp((s) => s.dismissLoadErrors);
  if (!errors.length) return null;
  return (
    <div className="banner error" role="alert">
      {errors.map((e) => (
        <p key={e}>{e}</p>
      ))}
      <button type="button" className="link" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
