/**
 * Panel-side bridge to the job page: makes sure content scripts are present in every frame,
 * picks the frame that holds the upload target / job description, and sends it work.
 */
import type { CaptureMode } from './adapters/capture';
import type { AttachOutcome, JobDescriptionCapture } from './adapters/types';
import { blobToBase64 } from './bytes';
import { isAtsHost } from './hosts';
import { sendToBackground, sendToFrame, type ProbeResult } from './messaging';
import { getTargetTab } from './targetTab';

const CONTENT_SCRIPT = 'content-scripts/content.js';

export class PageAccessError extends Error {}

export interface PageTarget {
  tabId: number;
  /** null when Chrome hides the URL because we have no access to the site yet. */
  url: string | null;
}

export async function resolveTarget(): Promise<PageTarget> {
  const tab = await getTargetTab();
  if (tab?.id === undefined) throw new PageAccessError('No job page found. Open the application page in a tab first.');
  return { tabId: tab.id, url: tab.url ?? null };
}

export function describeTarget(target: PageTarget): string {
  return target.url ? new URL(target.url).hostname : 'this site';
}

function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

const ALL_SITES = ['https://*/*', 'http://*/*'];

/**
 * Call early in a click handler: chrome.permissions.request needs the user's gesture.
 * - ATS hosts are covered by the manifest.
 * - A company page embedding an ATS iframe (e.g. Greenhouse) already has our content script in the
 *   iframe, so no prompt is needed.
 * - Other sites need the optional host permission for their origin. If Chrome hides the URL
 *   (no access yet), the only thing we can ask for is access to all sites.
 */
export async function ensureHostAccess(target: PageTarget): Promise<boolean> {
  if (target.url && isAtsHost(new URL(target.url).hostname)) return true;
  const origins = target.url ? [originPattern(target.url)] : ALL_SITES;
  if (await chrome.permissions.contains({ origins })) return true;
  const registered = await sendToBackground('GET_FRAMES', { tabId: target.tabId }).catch(() => [] as number[]);
  if (registered.length > 0) return true;
  return chrome.permissions.request({ origins });
}

/** Inject the content script into all frames we can reach and return the known frame ids. */
async function prepareFrames(tabId: number): Promise<number[]> {
  const frames = new Set<number>();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT],
    });
    results.forEach((r) => frames.add(r.frameId));
  } catch {
    // Top frame not accessible (e.g. company site embedding a Greenhouse iframe): rely on the registry.
  }
  (await sendToBackground('GET_FRAMES', { tabId }).catch(() => [] as number[])).forEach((f) => frames.add(f));
  if (frames.size === 0) frames.add(0);
  return [...frames];
}

interface FrameProbe extends ProbeResult {
  frameId: number;
}

async function probeAll(tabId: number): Promise<FrameProbe[]> {
  const frameIds = await prepareFrames(tabId);
  const probes = await Promise.all(
    frameIds.map(async (frameId) => {
      try {
        return { ...(await sendToFrame(tabId, frameId, 'CS_PROBE', {})), frameId };
      } catch {
        return null; // frame gone or script not reachable
      }
    }),
  );
  return probes.filter((p): p is FrameProbe => p !== null);
}

export interface AttachReport extends AttachOutcome {
  frameUrl: string;
}

export async function attachPdfToPage(target: PageTarget, blob: Blob, fileName: string): Promise<AttachReport> {
  const probes = await probeAll(target.tabId);
  if (probes.length === 0) {
    throw new PageAccessError('Could not reach the page. Reload the job page and try again.');
  }
  const withTarget = probes.filter((p) => p.hasUploadTarget).sort((a, b) => b.targetScore - a.targetScore);
  // No target yet (e.g. Workday step not reached): let the top frame's adapter wait for one.
  const chosen = withTarget[0] ?? probes.find((p) => p.isTop) ?? probes[0]!;
  const waitMs = withTarget.length ? 0 : 8000;
  const outcome = await sendToFrame(target.tabId, chosen.frameId, 'CS_ATTACH', {
    fileName,
    mimeType: 'application/pdf',
    base64: await blobToBase64(blob),
    waitMs,
  });
  if (!outcome.ok && probes.some((p) => p.embedsGreenhouse) && !probes.some((p) => p.adapter === 'greenhouse')) {
    return {
      ...outcome,
      frameUrl: chosen.url,
      detail: `${outcome.detail}. The form is in an embedded Greenhouse frame that did not respond; reload the page.`,
    };
  }
  return { ...outcome, frameUrl: chosen.url };
}

export async function captureJdFromPage(target: PageTarget, mode: CaptureMode): Promise<JobDescriptionCapture | null> {
  const probes = await probeAll(target.tabId);
  const results = await Promise.all(
    probes.map((p) => sendToFrame(target.tabId, p.frameId, 'CS_GET_JD', { mode }).catch(() => null)),
  );
  const found = results.filter((r): r is JobDescriptionCapture => r !== null);
  const rank = (r: JobDescriptionCapture) => ({ 'json-ld': 3, site: 2, selection: 1, manual: 0 })[r.source];
  found.sort((a, b) => rank(b) - rank(a) || b.text.length - a.text.length);
  return found[0] ?? null;
}
