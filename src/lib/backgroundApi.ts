/** Message contract handled by the background service worker. */
import type { RewriteResult, SelectResult } from './llm/pipeline';
import type { JdAnalysis, LineBudget, MasterResume } from './schemas';

export interface BackgroundApi {
  PING: { req: Record<string, never>; res: { pong: true } };
  /** Sent by every content script instance on load so the panel can find frames it cannot enumerate. */
  FRAME_HELLO: { req: { url: string }; res: { registered: boolean } };
  GET_FRAMES: { req: { tabId: number }; res: number[] };
  /** JD text -> structured analysis (analysis model). */
  LLM_ANALYZE: { req: { jdText: string; title: string; company: string }; res: JdAnalysis };
  /** Analysis + master -> validated, ID-repaired selection plan (tailoring model). */
  LLM_SELECT: {
    req: { analysis: JdAnalysis; master: MasterResume; pins: string[]; lineBudget: LineBudget; pageLimit: 1 | 2 };
    res: SelectResult;
  };
  /** Optional rephrasings of included bullets, each checked by the honesty guard. */
  LLM_REWRITE: {
    req: { analysis: JdAnalysis; master: MasterResume; bullets: { id: string; text: string }[] };
    res: RewriteResult;
  };
}
