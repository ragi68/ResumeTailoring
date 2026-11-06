/**
 * Minimal Anthropic Messages API client over fetch (runs in the background service worker).
 * Requests structured JSON output, validates with Zod, and degrades gracefully when a configured
 * model doesn't support a parameter (effort / output format / fallbacks).
 */
import type { z } from 'zod';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/** Models that accept server-side refusal fallbacks ("default" routing). */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type Effort = 'low' | 'medium' | 'high';
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface JsonRequest<T> {
  model: string;
  system: string;
  prompt: string;
  /** JSON Schema for structured output (additionalProperties: false, all properties required). */
  jsonSchema: Record<string, unknown>;
  zod: z.ZodType<T>;
  maxTokens: number;
  effort?: Effort;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'network' | 'refusal' | 'truncated' | 'invalid_output' | 'no_key',
    readonly status?: number,
  ) {
    super(message);
  }
}

interface ApiTextBlock {
  type: 'text';
  text: string;
}
interface ApiResponse {
  content: ({ type: string } | ApiTextBlock)[];
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}
interface ApiErrorBody {
  error?: { type?: string; message?: string };
}

const isText = (b: { type: string }): b is ApiTextBlock => b.type === 'text' && typeof (b as ApiTextBlock).text === 'string';

/** Pull a JSON object out of model text (tolerates code fences or stray prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new SyntaxError('No JSON object in the response');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClientOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  /** Backoff base for 429/5xx retries (tests set 0). */
  retryDelayMs?: number;
}

export function createClient(opts: ClientOptions) {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const retryDelay = opts.retryDelayMs ?? 1500;
  if (!opts.apiKey) throw new LlmError('No Anthropic API key. Add one in Settings.', 'no_key');

  async function post(body: Record<string, unknown>, beta: string[]): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (beta.length) headers['anthropic-beta'] = beta.join(',');
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (e) {
        if (attempt < 2) {
          await sleep(retryDelay * (attempt + 1));
          continue;
        }
        throw new LlmError(`Network error calling the Anthropic API: ${e instanceof Error ? e.message : String(e)}`, 'network');
      }
      if (res.ok) return (await res.json()) as ApiResponse;
      const errBody = (await res.json().catch(() => ({}))) as ApiErrorBody;
      const message = errBody.error?.message ?? res.statusText;
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : retryDelay * (attempt + 1) * 2);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new LlmError(`The API key was rejected (${res.status}): ${message}`, 'auth', res.status);
      if (res.status === 429) throw new LlmError(`Rate limited by the Anthropic API: ${message}`, 'rate_limit', res.status);
      if (res.status === 529 || res.status >= 500) throw new LlmError(`The Anthropic API is overloaded or unavailable (${res.status}). Try again shortly.`, 'overloaded', res.status);
      throw new LlmError(`Anthropic API error (${res.status}): ${message}`, 'bad_request', res.status);
    }
  }

  /**
   * Call the model and return Zod-validated JSON. On a 400 that names an unsupported parameter,
   * retry without it. On output that fails validation, retry once with the validation errors.
   */
  async function json<T>(req: JsonRequest<T>): Promise<T> {
    let useEffort = req.effort !== undefined;
    let useFormat = true;
    let useFallbacks = FALLBACK_MODELS.has(req.model);
    let feedback: string | null = null;
    let previous: string | null = null;

    for (let attempt = 0; attempt < 6; attempt++) {
      const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: req.prompt }];
      if (feedback && previous) {
        messages.push({ role: 'assistant', content: previous }, { role: 'user', content: feedback });
      }
      const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens, system: req.system, messages };
      const outputConfig: Record<string, unknown> = {};
      if (useFormat) outputConfig['format'] = { type: 'json_schema', schema: req.jsonSchema };
      if (useEffort) outputConfig['effort'] = req.effort;
      if (Object.keys(outputConfig).length) body['output_config'] = outputConfig;
      if (useFallbacks) body['fallbacks'] = 'default';

      let res: ApiResponse;
      try {
        res = await post(body, useFallbacks ? [FALLBACK_BETA] : []);
      } catch (e) {
        if (e instanceof LlmError && e.kind === 'bad_request') {
          const m = e.message.toLowerCase();
          if (useFallbacks && /fallback/.test(m)) {
            useFallbacks = false;
            continue;
          }
          if (useEffort && /effort/.test(m)) {
            useEffort = false;
            continue;
          }
          if (useFormat && /(output_config|format|json_schema|schema)/.test(m)) {
            useFormat = false;
            continue;
          }
        }
        throw e;
      }

      if (res.stop_reason === 'refusal') {
        throw new LlmError(`The model declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`, 'refusal');
      }
      if (res.stop_reason === 'max_tokens') throw new LlmError('The model response was cut off (max_tokens). Try again.', 'truncated');
      const text = res.content.filter(isText).map((b) => b.text).join('');

      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch {
        if (feedback === null) {
          previous = text || '(empty)';
          feedback = 'That was not a valid JSON object. Reply with only the JSON object that matches the schema.';
          continue;
        }
        throw new LlmError('The model did not return valid JSON.', 'invalid_output');
      }
      const result = req.zod.safeParse(parsed);
      if (result.success) return result.data;
      if (feedback === null) {
        previous = text;
        feedback = `The JSON failed validation:\n${result.error.issues
          .slice(0, 8)
          .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n')}\nReply with only the corrected JSON object.`;
        continue;
      }
      throw new LlmError(`The model's JSON did not match the expected shape: ${result.error.issues[0]?.message ?? 'unknown'}`, 'invalid_output');
    }
    throw new LlmError('Could not get a valid response from the model.', 'invalid_output');
  }

  return { json };
}

export type LlmClient = ReturnType<typeof createClient>;
