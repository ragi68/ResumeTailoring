import { useEffect, useRef, useState } from 'react';
import { generateResumePdf, type GeneratedPdf } from '@/lib/resumePdf';
import type { MasterResume, Selection } from '@/lib/schemas';

export type PdfState =
  | { status: 'idle' }
  | { status: 'loading'; previous: GeneratedPdf | null }
  | { status: 'ready'; pdf: GeneratedPdf }
  | { status: 'error'; error: string; previous: GeneratedPdf | null };

export function currentPdf(s: PdfState): GeneratedPdf | null {
  if (s.status === 'ready') return s.pdf;
  if (s.status === 'loading' || s.status === 'error') return s.previous;
  return null;
}

/** Regenerates the in-memory PDF (debounced) whenever the master, selection or pins change. */
export function usePdf(master: MasterResume, sel: Selection | null, pins: string[]): PdfState {
  const [state, setState] = useState<PdfState>({ status: 'idle' });
  const generation = useRef(0);
  const latest = useRef<GeneratedPdf | null>(null);

  useEffect(() => {
    if (!sel) {
      setState({ status: 'idle' });
      return;
    }
    const gen = ++generation.current;
    setState({ status: 'loading', previous: latest.current });
    const timer = setTimeout(() => {
      generateResumePdf(master, sel, pins).then(
        (pdf) => {
          if (gen !== generation.current) {
            void pdf.doc.destroy();
            return;
          }
          const old = latest.current;
          latest.current = pdf;
          setState({ status: 'ready', pdf });
          if (old) void old.doc.destroy();
        },
        (e: unknown) => {
          if (gen === generation.current) setState({ status: 'error', error: e instanceof Error ? e.message : String(e), previous: latest.current });
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [master, sel, pins]);

  return state;
}
