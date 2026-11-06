/** Tailoring pipeline steps. Pure functions over an LlmClient so they can be tested with a mock fetch. */
import { effectiveBudget } from '../budget';
import type { JdAnalysis, MasterResume, Settings } from '../schemas';
import type { ValidSelectionPlan } from '../selection';
import type { LlmClient } from './client';
import { repairPlan } from './idRepair';
import {
  ANALYZE_JSON_SCHEMA,
  ANALYZE_SYSTEM,
  AnalysisResultSchema,
  RawRewritesSchema,
  RawSelectPlanSchema,
  REWRITE_JSON_SCHEMA,
  REWRITE_SYSTEM,
  SELECT_JSON_SCHEMA,
  SELECT_SYSTEM,
  analyzePrompt,
  rewritePrompt,
  selectPrompt,
} from './prompts';
import { checkRewrite, type RewriteSuggestion } from './rewriteGuard';

const MAX_JD_CHARS = 60_000;

export async function analyzeJd(client: LlmClient, model: string, jdText: string, hint: { title: string; company: string }): Promise<JdAnalysis> {
  const text = jdText.trim();
  if (text.length < 50) throw new Error('The job description is too short to analyze. Capture or paste the full posting.');
  if (text.length > MAX_JD_CHARS) {
    throw new Error(`The job description is ${text.length.toLocaleString()} characters. Trim it to the posting itself (under ${MAX_JD_CHARS.toLocaleString()}).`);
  }
  const a = await client.json({
    model,
    system: ANALYZE_SYSTEM,
    prompt: analyzePrompt(text, hint),
    jsonSchema: ANALYZE_JSON_SCHEMA,
    zod: AnalysisResultSchema,
    maxTokens: 4000,
    effort: 'low',
  });
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  return {
    ...a,
    title: a.title || hint.title,
    company: a.company || hint.company,
    requiredSkills: clean(a.requiredSkills),
    niceToHaves: clean(a.niceToHaves),
    keywords: clean(a.keywords),
  };
}

export interface SelectResult {
  plan: ValidSelectionPlan;
  issues: string[];
  rationale: string;
}

export async function selectContent(
  client: LlmClient,
  model: string,
  args: { analysis: JdAnalysis; master: MasterResume; pins: string[]; settings: Pick<Settings, 'lineBudget' | 'pageLimit'> },
): Promise<SelectResult> {
  const raw = await client.json({
    model,
    system: SELECT_SYSTEM,
    prompt: selectPrompt({ analysis: args.analysis, master: args.master, pins: args.pins, budget: effectiveBudget(args.settings), pageLimit: args.settings.pageLimit }),
    jsonSchema: SELECT_JSON_SCHEMA,
    zod: RawSelectPlanSchema,
    maxTokens: 8000,
    effort: 'medium',
  });
  const { plan, issues } = repairPlan(raw, args.master);
  return { plan, issues, rationale: raw.rationale };
}

export interface RewriteResult {
  suggestions: RewriteSuggestion[];
  rejected: { bulletId: string; text: string; problems: string[] }[];
}

export async function suggestRewrites(
  client: LlmClient,
  model: string,
  args: { analysis: JdAnalysis; master: MasterResume; bullets: { id: string; text: string }[] },
): Promise<RewriteResult> {
  if (args.bullets.length === 0) return { suggestions: [], rejected: [] };
  const skillNames = args.master.skillGroups.flatMap((g) => g.skills.flatMap((s) => [s.name, ...s.aliases]));
  const raw = await client.json({
    model,
    system: REWRITE_SYSTEM,
    prompt: rewritePrompt({ analysis: args.analysis, bullets: args.bullets, skillNames }),
    jsonSchema: REWRITE_JSON_SCHEMA,
    zod: RawRewritesSchema,
    maxTokens: 8000,
    effort: 'medium',
  });
  const byId = new Map(args.bullets.map((b) => [b.id, b.text]));
  const jdTerms = [...args.analysis.requiredSkills, ...args.analysis.niceToHaves, ...args.analysis.keywords];
  const out: RewriteResult = { suggestions: [], rejected: [] };
  const seen = new Set<string>();
  for (const s of raw.suggestions) {
    const original = byId.get(s.bulletId);
    if (!original || seen.has(s.bulletId)) continue; // unknown/duplicate id: ignore
    seen.add(s.bulletId);
    const check = checkRewrite(original, s.text, args.master, jdTerms);
    if (check.ok) out.suggestions.push({ bulletId: s.bulletId, original, text: s.text.trim(), reason: s.reason });
    else out.rejected.push({ bulletId: s.bulletId, text: s.text, problems: check.problems });
  }
  return out;
}
