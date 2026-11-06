/** Shared types for site adapters (these run inside content scripts). */

export type JdSource = 'json-ld' | 'site' | 'selection' | 'manual';

export interface JobDescriptionCapture {
  title: string;
  company: string;
  text: string;
  source: JdSource;
  url: string;
}

export type SiteJobDescription = Omit<JobDescriptionCapture, 'source' | 'url'>;

export type UploadTarget =
  | { kind: 'input'; el: HTMLInputElement; score: number; label: string }
  | { kind: 'dropzone'; el: HTMLElement; score: number; label: string };

export type AttachMethod = 'input' | 'dropzone';

export interface AttachOutcome {
  ok: boolean;
  method?: AttachMethod;
  adapter: string;
  detail: string;
  /** True when the adapter could confirm the page accepted the file (input.files populated). */
  verified: boolean;
}

export interface FindOptions {
  /** How long an adapter may wait for an upload target to appear (e.g. Workday's multi-step flow). */
  waitMs?: number;
}

export interface SiteAdapter {
  readonly name: string;
  /** Site-specific JD extraction. JSON-LD and selection layers are handled by the capture pipeline. */
  getJobDescription(doc: Document): SiteJobDescription | null;
  findUploadTarget(doc: Document, opts?: FindOptions): Promise<UploadTarget | null>;
  attachFile(file: File, doc: Document, opts?: FindOptions): Promise<AttachOutcome>;
}
