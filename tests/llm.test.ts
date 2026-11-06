// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { selectAdapter } from '@/lib/adapters';
import { captureJobDescription } from '@/lib/adapters/capture';
import { ANTHROPIC_URL, LlmError, createClient, extractJson, type FetchLike } from '@/lib/llm/client';
import { repairPlan } from '@/lib/llm/idRepair';
import { analyzeJd, selectContent, suggestRewrites } from '@/lib/llm/pipeline';
import { RawSelectPlanSchema } from '@/lib/llm/prompts';
import { checkRewrite, wordDiff } from '@/lib/llm/rewriteGuard';
import { DEFAULT_SETTINGS, type JdAnalysis } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { applyPlan, defaultSelection, emptyJob, indexMaster, resolveResume } from '@/lib/selection';

const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.resolve('fixtures/analysis', name), 'utf8'));
const master = SEED_MASTER;

function jdFrom(file: string, url: string) {
  const doc = new JSDOM(fs.readFileSync(path.resolve('fixtures', file), 'utf8'), { url }).window.document;
  return captureJobDescription(doc, selectAdapter(new URL(url).hostname))!;
}

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Mock fetch: returns queued responses in order and records each request. */
function mockFetch(responses: (() => Response)[]) {
  const calls: Recorded[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next();
  };
  return { impl, calls };
}

const ok = (json: unknown, stop = 'end_turn') => () =>
  new Response(JSON.stringify({ content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }], stop_reason: stop }), { status: 200 });
const err = (status: number, message: string) => () => new Response(JSON.stringify({ type: 'error', error: { type: 'x', message } }), { status });

const client = (impl: FetchLike) => createClient({ apiKey: 'sk-ant-test', fetchImpl: impl, retryDelayMs: 0 });

describe('Anthropic client', () => {
  it('sends a direct-browser request with structured output to the configured model', async () => {
    const { impl, calls } = mockFetch([ok(fixture('lever.analysis.json'))]);
    const jd = jdFrom('lever.html', 'https://jobs.lever.co/northstar/1/apply');
    const a = await analyzeJd(client(impl), 'my-analysis-model', jd.text, { title: jd.title, company: jd.company });
    expect(a.requiredSkills).toContain('Kubernetes');
    const call = calls[0]!;
    expect(call.url).toBe(ANTHROPIC_URL);
    expect(call.headers['x-api-key']).toBe('sk-ant-test');
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(call.headers['anthropic-version']).toBeTruthy();
    expect(call.body['model']).toBe('my-analysis-model');
    const oc = call.body['output_config'] as { format: { type: string }; effort: string };
    expect(oc.format.type).toBe('json_schema');
    expect(oc.effort).toBe('low');
    const msgs = call.body['messages'] as { content: string }[];
    expect(msgs[0]!.content).toContain('Strong Golang and Kubernetes');
  });

  it('adds server-side fallbacks for supported models only', async () => {
    const { impl, calls } = mockFetch([ok(fixture('lever.analysis.json')), ok(fixture('lever.analysis.json'))]);
    const c = client(impl);
    const jd = 'x'.repeat(80);
    await analyzeJd(c, 'claude-sonnet-5-5', jd, { title: '', company: '' });
    await analyzeJd(c, 'claude-haiku-5-5', jd, { title: '', company: '' });
    expect(calls[0]!.body['fallbacks']).toBe('default');
    expect(calls[0]!.headers['anthropic-beta']).toMatch(/server-side-fallback/);
    expect(calls[1]!.body['fallbacks']).toBeUndefined();
  });

  it('retries without unsupported parameters (effort, then output format)', async () => {
    const { impl, calls } = mockFetch([
      err(400, 'output_config.effort: Extra inputs are not permitted'),
      err(400, 'output_config.format: json_schema is not supported for this model'),
      ok('Here you go:\n```json\n' + JSON.stringify(fixture('lever.analysis.json')) + '\n```'),
    ]);
    const a = await analyzeJd(client(impl), 'claude-old-model', 'y'.repeat(80), { title: '', company: '' });
    expect(a.company).toBe('Northstar Freight');
    expect((calls[0]!.body['output_config'] as Record<string, unknown>)['effort']).toBe('low');
    expect((calls[1]!.body['output_config'] as Record<string, unknown>)['effort']).toBeUndefined();
    expect(calls[2]!.body['output_config']).toBeUndefined();
  });

  it('asks once for a correction when the JSON fails validation', async () => {
    const bad = { ...(fixture('lever.analysis.json') as object), seniority: 'wizard' };
    const { impl, calls } = mockFetch([ok(bad), ok(fixture('lever.analysis.json'))]);
    const a = await analyzeJd(client(impl), 'm', 'z'.repeat(80), { title: '', company: '' });
    expect(a.seniority).toBe('senior');
    const msgs = calls[1]!.body['messages'] as { role: string; content: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[2]!.content).toMatch(/seniority/);
  });

  it('maps errors: auth, refusal, truncation, retries overload', async () => {
    await expect(analyzeJd(client(mockFetch([err(401, 'invalid x-api-key')]).impl), 'm', 'a'.repeat(80), { title: '', company: '' })).rejects.toMatchObject({ kind: 'auth' });
    await expect(analyzeJd(client(mockFetch([ok('{}', 'refusal')]).impl), 'm', 'a'.repeat(80), { title: '', company: '' })).rejects.toMatchObject({ kind: 'refusal' });
    await expect(analyzeJd(client(mockFetch([ok('{"title":', 'max_tokens')]).impl), 'm', 'a'.repeat(80), { title: '', company: '' })).rejects.toMatchObject({ kind: 'truncated' });
    const { impl, calls } = mockFetch([err(529, 'Overloaded'), ok(fixture('lever.analysis.json'))]);
    await analyzeJd(client(impl), 'm', 'a'.repeat(80), { title: '', company: '' });
    expect(calls).toHaveLength(2);
    expect(() => createClient({ apiKey: '' })).toThrow(LlmError);
  });

  it('rejects job descriptions that are too short', async () => {
    await expect(analyzeJd(client(mockFetch([]).impl), 'm', 'too short', { title: '', company: '' })).rejects.toThrow(/too short/);
  });

  it('extracts JSON from fenced or chatty output', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });
});

describe('ID validation and repair', () => {
  const raw = RawSelectPlanSchema.parse(fixture('lever.select.json'));
  const { plan, issues } = repairPlan(raw, master);
  const idx = indexMaster(master);

  it('every id in the repaired plan exists in the master and belongs where it is listed', () => {
    for (const b of plan.blocks) {
      expect(idx.blocks.has(b.refId)).toBe(true);
      for (const bid of b.bulletIds) expect(idx.bulletOwner.get(bid)).toBe(b.refId);
    }
    for (const s of plan.skillIds) expect(idx.skills.has(s)).toBe(true);
    expect(plan.summaryId === null || idx.summaries.has(plan.summaryId)).toBe(true);
  });

  it('repairs what it can and reports everything it changed', () => {
    expect(plan.summaryId).toBe('sum_backend'); // mapped by label
    expect(plan.blocks.map((b) => b.refId)).toEqual(['exp_northwind', 'exp_lumen', 'exp_brightpath', 'proj_tracekit']);
    // b_lh_2 was listed under Northwind: moved to Lumen. b_bp_2 under an unknown block: re-homed to BrightPath.
    expect(plan.blocks.find((b) => b.refId === 'exp_lumen')!.bulletIds).toEqual(['b_lh_2', 'b_lh_1', 'b_lh_3']);
    expect(plan.blocks.find((b) => b.refId === 'exp_brightpath')!.bulletIds).toEqual(['b_bp_2']);
    expect(plan.blocks[0]!.bulletIds).not.toContain('b_fake_99');
    // "Kubernetes" and "golang" map by name/alias; the duplicate Go collapses; "Rust" is not in the master.
    expect(plan.skillIds).toEqual(['sk_go', 'sk_k8s', 'sk_kafka', 'sk_grpc', 'sk_terraform', 'sk_postgres', 'sk_otel']);
    const text = issues.join('\n');
    for (const s of ['b_fake_99', 'exp_imaginary', 'Rust', 'Lumen Health', 'b_lh_2']) expect(text).toContain(s);
  });

  it('a block with no valid bullets gets its first bullet so it is not an empty heading', () => {
    const r = repairPlan({ summaryId: null, blocks: [{ refId: 'exp_lumen', bulletIds: ['nope'] }], skillIds: [], rationale: '' }, master);
    expect(r.plan.blocks[0]!.bulletIds).toEqual(['b_lh_1']);
  });
});

describe('select step end to end with a mocked API', () => {
  it.each([
    ['lever', 'lever.analysis.json', 'lever.select.json'],
    ['ashby', 'ashby.analysis.json', 'ashby.select.json'],
  ])('%s: produces a selection containing only master content', async (_name, analysisFile, selectFile) => {
    const { impl, calls } = mockFetch([ok(fixture(selectFile))]);
    const analysis = fixture(analysisFile) as JdAnalysis;
    const res = await selectContent(client(impl), DEFAULT_SETTINGS.tailorModel, { analysis, master, pins: ['b_bp_3'], settings: DEFAULT_SETTINGS });
    const prompt = (calls[0]!.body['messages'] as { content: string }[])[0]!.content;
    expect(prompt).toContain('[b_nw_1]');
    expect(prompt).toContain('Pinned IDs (must include): b_bp_3');
    expect(calls[0]!.body['model']).toBe('claude-sonnet-5-5');

    const sel = applyPlan(master, res.plan, ['b_bp_3'], defaultSelection(master, emptyJob(), 'j'));
    const resolved = resolveResume(master, sel);
    const masterTexts = new Set(master.experience.concat().flatMap((e) => e.bullets.map((b) => b.text)).concat(master.projects.flatMap((p) => p.bullets.map((b) => b.text))));
    for (const e of [...resolved.experience, ...resolved.projects]) for (const b of e.bullets) expect(masterTexts.has(b.text)).toBe(true);
    // Pinned bullet present even though the model didn't pick it.
    expect(resolved.experience.flatMap((e) => e.bullets.map((b) => b.id))).toContain('b_bp_3');
  });
});

describe('rewrite suggestions', () => {
  const analysis = fixture('lever.analysis.json') as JdAnalysis;
  const bullets = master.experience[0]!.bullets.map((b) => ({ id: b.id, text: b.text }));

  it('keeps honest rephrasings and rejects ones that add claims', async () => {
    const { impl } = mockFetch([ok(fixture('lever.rewrites.json'))]);
    const r = await suggestRewrites(client(impl), 'm', { analysis, master, bullets });
    expect(r.suggestions.map((s) => s.bulletId)).toEqual(['b_nw_3']);
    expect(r.suggestions[0]!.text).toContain('Golang gRPC');
    const rejected = Object.fromEntries(r.rejected.map((x) => [x.bulletId, x.problems.join('; ')]));
    expect(rejected['b_nw_2']).toMatch(/40/);
    expect(rejected['b_nw_5']).toMatch(/Kubernetes/);
    expect(rejected['b_nw_4']).toMatch(/no change/);
    expect(rejected['b_nw_1']).toMatch(/distributed systems/);
    expect(rejected['b_unknown']).toBeUndefined();
  });

  it('guard allows synonyms from the skill aliases and flags new numbers', () => {
    expect(checkRewrite('Built services in Go on k8s.', 'Built services in Golang on Kubernetes.', master).ok).toBe(true);
    expect(checkRewrite('Cut costs.', 'Cut costs by 30%.', master).problems.join()).toMatch(/30%/);
  });

  it('word diff marks insertions and deletions', () => {
    expect(wordDiff('Built a Go service', 'Built a Golang service')).toEqual([
      { type: 'same', text: 'Built a ' },
      { type: 'del', text: 'Go' },
      { type: 'ins', text: 'Golang' },
      { type: 'same', text: ' service' },
    ]);
  });
});
