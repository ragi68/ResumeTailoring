/** Prompts and JSON schemas for the analyze / select / rewrite steps. */
import { z } from 'zod';
import { SENIORITY_LEVELS, type JdAnalysis, type LineBudget, type MasterResume } from '../schemas';

// ---------------- analyze ----------------

export const ANALYZE_SYSTEM = `You extract structured requirements from job descriptions for a resume-tailoring tool.
Return only facts stated or clearly implied in the posting. Do not invent requirements.
- requiredSkills: concrete skills/technologies/qualifications the posting requires (short noun phrases, e.g. "Kubernetes", "Python", "SQL").
- niceToHaves: skills listed as preferred, bonus, or nice to have.
- keywords: other important terms an applicant tracking system would match (domain terms, methodologies, responsibilities), excluding the two lists above.
Keep each item short (1-4 words), use the posting's own wording, no duplicates across lists. At most 15 items per list.`;

export const ANALYZE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'company', 'seniority', 'domain', 'requiredSkills', 'niceToHaves', 'keywords'],
  properties: {
    title: { type: 'string', description: 'Job title, or empty string if unknown' },
    company: { type: 'string', description: 'Hiring company, or empty string if unknown' },
    seniority: { type: 'string', enum: [...SENIORITY_LEVELS] },
    domain: { type: 'string', description: 'Industry or product domain in a few words' },
    requiredSkills: { type: 'array', items: { type: 'string' } },
    niceToHaves: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function analyzePrompt(jdText: string, hint: { title: string; company: string }): string {
  const known = [hint.title && `Title shown on the page: ${hint.title}`, hint.company && `Company shown on the page: ${hint.company}`].filter(Boolean).join('\n');
  return `${known ? `${known}\n\n` : ''}<job_description>\n${jdText}\n</job_description>`;
}

// ---------------- select ----------------

export const SELECT_SYSTEM = `You tailor a resume by SELECTING and ORDERING existing content. You never write resume text.

Rules:
- Use only IDs that appear in the candidate's master resume below. Never invent IDs, skills, experience, or metrics.
- blocks: the experience entries and projects to include, in display order, each with the bullet IDs to show in order (most relevant first). A bullet ID must belong to the block it is listed under.
- Keep experience entries in reverse-chronological order unless an entry is irrelevant enough to omit. Recent roles should normally be kept.
- Projects are an optional pool: include only projects that strengthen the application for this job.
- Prefer bullets that match required skills, then nice-to-haves, then quantified results.
- skillIds: skills relevant to the job first, then other genuinely useful ones. Omit clearly irrelevant skills.
- summaryId: the summary variant that best fits the role, or null if none fits.
- Pinned IDs must be included.
- Respect the bullet targets so the resume fits the page limit.
- rationale: one or two sentences on the choices.`;

export const SELECT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summaryId', 'blocks', 'skillIds', 'rationale'],
  properties: {
    summaryId: { type: ['string', 'null'] },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['refId', 'bulletIds'],
        properties: {
          refId: { type: 'string' },
          bulletIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    skillIds: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
} as const;

/** Raw model output for the select step (IDs not yet validated against the master). */
export const RawSelectPlanSchema = z.object({
  summaryId: z.string().nullable(),
  blocks: z.array(z.object({ refId: z.string(), bulletIds: z.array(z.string()) })),
  skillIds: z.array(z.string()),
  rationale: z.string(),
});
export type RawSelectPlan = z.infer<typeof RawSelectPlanSchema>;

/** Rough bullet targets from the line budget (each bullet ~1.4 lines, each entry header ~2.4). */
export function bulletTargets(master: MasterResume, budget: LineBudget): { experience: number; projects: number } {
  const roles = master.experience.length;
  const experience = Math.max(roles, Math.floor((budget.experience - 1.8 - roles * 2.4) / 1.4));
  const projects = Math.max(0, Math.floor((budget.projects - 1.8 - 2 * 1.4) / 1.4));
  return { experience, projects };
}

export function serializeMaster(master: MasterResume): string {
  const lines: string[] = [];
  const tags = (t: string[]) => (t.length ? ` (tags: ${t.join(', ')})` : '');
  lines.push('SUMMARY VARIANTS');
  for (const s of master.summaries) lines.push(`[${s.id}] ${s.label}: ${s.text}`);
  lines.push('', 'EXPERIENCE (master order is reverse-chronological)');
  for (const e of master.experience) {
    lines.push(`[${e.id}] ${e.title}, ${e.company} | ${e.location} | ${e.start} to ${e.end}`);
    for (const b of e.bullets) lines.push(`  [${b.id}] ${b.text}${tags(b.tags)}`);
  }
  lines.push('', 'PROJECTS (optional pool)');
  for (const p of master.projects) {
    lines.push(`[${p.id}] ${p.name}${tags(p.tags)}`);
    for (const b of p.bullets) lines.push(`  [${b.id}] ${b.text}${tags(b.tags)}`);
  }
  lines.push('', 'SKILLS');
  for (const g of master.skillGroups) {
    lines.push(`${g.name}: ${g.skills.map((s) => `[${s.id}] ${s.name}${s.aliases.length ? ` (aka ${s.aliases.join(', ')})` : ''}`).join('; ')}`);
  }
  lines.push('', 'EDUCATION (always included; do not list in blocks)');
  for (const e of master.education) lines.push(`[${e.id}] ${e.degree}, ${e.school}`);
  return lines.join('\n');
}

export function selectPrompt(args: {
  analysis: JdAnalysis;
  master: MasterResume;
  pins: string[];
  budget: LineBudget;
  pageLimit: 1 | 2;
}): string {
  const t = bulletTargets(args.master, args.budget);
  return `<job_analysis>
${JSON.stringify(args.analysis, null, 2)}
</job_analysis>

<master_resume>
${serializeMaster(args.master)}
</master_resume>

Pinned IDs (must include): ${args.pins.length ? args.pins.join(', ') : 'none'}
Page limit: ${args.pageLimit} page(s). Targets: about ${t.experience} experience bullets in total and about ${t.projects} project bullets in total.`;
}

// ---------------- rewrite ----------------

export const REWRITE_SYSTEM = `You suggest optional rephrasings of resume bullets so they use the job posting's terminology.

Hard rules (a suggestion that breaks any rule is worse than no suggestion):
- Rephrase only. Keep every fact, number, technology, scope and outcome exactly as stated.
- Never add numbers, metrics, technologies, tools, responsibilities, team sizes or results that are not in the original bullet.
- You may swap a term for an exact synonym the candidate already uses elsewhere (listed in their skills), e.g. "Golang" for "Go".
- Keep it one sentence, similar length, past tense for past roles.
- If a bullet cannot be improved honestly, leave it out.
Return at most one suggestion per bullet.`;

export const REWRITE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bulletId', 'text', 'reason'],
        properties: {
          bulletId: { type: 'string' },
          text: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export const RawRewritesSchema = z.object({
  suggestions: z.array(z.object({ bulletId: z.string(), text: z.string(), reason: z.string() })),
});
export type RawRewrites = z.infer<typeof RawRewritesSchema>;

export function rewritePrompt(args: { analysis: JdAnalysis; bullets: { id: string; text: string }[]; skillNames: string[] }): string {
  return `<job_terms>
Required: ${args.analysis.requiredSkills.join(', ')}
Nice to have: ${args.analysis.niceToHaves.join(', ')}
Keywords: ${args.analysis.keywords.join(', ')}
</job_terms>

<candidate_skills>
${args.skillNames.join(', ')}
</candidate_skills>

<bullets>
${args.bullets.map((b) => `[${b.id}] ${b.text}`).join('\n')}
</bullets>`;
}

export const AnalysisResultSchema = z.object({
  title: z.string(),
  company: z.string(),
  seniority: z.enum(SENIORITY_LEVELS),
  domain: z.string(),
  requiredSkills: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  keywords: z.array(z.string()),
});
