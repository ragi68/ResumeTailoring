import { selectAdapter } from '@/lib/adapters';
import { captureJobDescription } from '@/lib/adapters/capture';
import { base64ToBytes } from '@/lib/bytes';
import { ATS_HOST_PATTERNS } from '@/lib/hosts';
import { listen, sendToBackground, type ContentApi, type Handlers } from '@/lib/messaging';

/**
 * Runs in every frame. Registered statically for the ATS hosts; injected on demand
 * (chrome.scripting, all frames) on any other site after the user grants access.
 */
export default defineContentScript({
  matches: [...ATS_HOST_PATTERNS],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    // Static registration and on-demand injection can both run in a frame, and an extension reload
    // leaves the old instance orphaned. WXT's context invalidates older instances synchronously
    // when a newer one starts, so exactly one instance answers messages.
    const adapter = selectAdapter(location.hostname);

    const handlers: Handlers<ContentApi> = {
      async CS_PROBE() {
        const target = await adapter.findUploadTarget(document);
        const jd = captureJobDescription(document, adapter);
        return {
          url: location.href,
          isTop: window === window.top,
          adapter: adapter.name,
          hasUploadTarget: target !== null,
          targetScore: target?.score ?? 0,
          targetLabel: target?.label ?? '',
          jdLength: jd?.text.length ?? 0,
          embedsGreenhouse: document.querySelector('iframe#grnhse_iframe, iframe[src*="greenhouse.io"]') !== null,
        };
      },
      async CS_GET_JD(req) {
        return captureJobDescription(document, adapter, req.mode);
      },
      async CS_ATTACH(req) {
        const file = new File([base64ToBytes(req.base64)], req.fileName, {
          type: req.mimeType,
          lastModified: Date.now(),
        });
        return adapter.attachFile(file, document, { waitMs: req.waitMs });
      },
    };
    const unlisten = listen<ContentApi>(handlers);
    ctx.onInvalidated(unlisten);

    sendToBackground('FRAME_HELLO', { url: location.href }).catch(() => {
      /* background may be restarting; the panel can still enumerate frames via scripting */
    });
  },
});
