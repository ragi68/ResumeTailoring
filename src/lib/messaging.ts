/**
 * Typed message contracts between the panel/tab app, the background worker and content scripts.
 * Every response is wrapped in `Result<T>` so errors cross the boundary as data, not as lost exceptions.
 */
import type { CaptureMode } from './adapters/capture';
import type { AttachOutcome, JobDescriptionCapture } from './adapters/types';
import type { BackgroundApi } from './backgroundApi';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type ApiShape<Api> = { [K in keyof Api]: { req: object; res: unknown } };

export type RequestOf<Api extends ApiShape<Api>> = { [K in keyof Api & string]: { type: K } & Api[K]['req'] }[keyof Api &
  string];

export type Handlers<Api extends ApiShape<Api>> = {
  [K in keyof Api & string]: (req: Api[K]['req'], sender: chrome.runtime.MessageSender) => Promise<Api[K]['res']>;
};

// ---------- Content script API ----------

export interface ProbeResult {
  url: string;
  isTop: boolean;
  adapter: string;
  hasUploadTarget: boolean;
  targetScore: number;
  targetLabel: string;
  jdLength: number;
  /** True when this frame embeds a Greenhouse iframe (the form lives in the child frame). */
  embedsGreenhouse: boolean;
}

export interface ContentApi {
  CS_PROBE: { req: Record<string, never>; res: ProbeResult };
  CS_GET_JD: { req: { mode: CaptureMode }; res: JobDescriptionCapture | null };
  CS_ATTACH: {
    req: { fileName: string; mimeType: string; base64: string; waitMs: number };
    res: AttachOutcome;
  };
}
export type ContentRequest = RequestOf<ContentApi>;

// ---------- Helpers ----------

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isTypedMessage(msg: unknown): msg is { type: string } {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type?: unknown }).type === 'string';
}

/** Register handlers for one API; messages whose type is not in `handlers` are ignored. Returns an unsubscribe function. */
export function listen<Api extends ApiShape<Api>>(handlers: Handlers<Api>): () => void {
  const listener = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void): boolean => {
    if (!isTypedMessage(msg) || !Object.hasOwn(handlers, msg.type)) return false;
    const handler = handlers[msg.type as keyof Api & string] as (
      req: unknown,
      sender: chrome.runtime.MessageSender,
    ) => Promise<unknown>;
    handler(msg, sender).then(
      (data) => sendResponse({ ok: true, data } satisfies Result<unknown>),
      (e: unknown) => sendResponse({ ok: false, error: errorMessage(e) } satisfies Result<unknown>),
    );
    return true; // async response
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

function unwrap<T>(res: Result<T> | undefined, what: string): T {
  if (!res) throw new Error(`No response to ${what}`);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export async function sendToBackground<K extends keyof BackgroundApi & string>(
  type: K,
  req: BackgroundApi[K]['req'],
): Promise<BackgroundApi[K]['res']> {
  const res = (await chrome.runtime.sendMessage({ type, ...req })) as Result<BackgroundApi[K]['res']> | undefined;
  return unwrap(res, type);
}

export async function sendToFrame<K extends keyof ContentApi & string>(
  tabId: number,
  frameId: number,
  type: K,
  req: ContentApi[K]['req'],
): Promise<ContentApi[K]['res']> {
  const res = (await chrome.tabs.sendMessage(tabId, { type, ...req }, { frameId })) as
    | Result<ContentApi[K]['res']>
    | undefined;
  return unwrap(res, type);
}
