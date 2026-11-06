import { describe, expect, it } from 'vitest';
import { analyzeKeywordGaps, containsTerm, findSkillForTerm, matchesAny, normalizeTerm, termForms } from '@/lib/keywords';
import type { JdAnalysis } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { defaultSelection, emptyJob } from '@/lib/selection';

const master = SEED_MASTER;

describe('alias matching', () => {
  it('normalizes punctuation but keeps tech characters', () => {
    expect(normalizeTerm('Node.js,')).toBe('node.js');
    expect(normalizeTerm('C++ / C#')).toBe('c++ c#');
    expect(normalizeTerm('Kubernetes.')).toBe('kubernetes');
    expect(normalizeTerm('CI/CD')).toBe('ci cd');
  });

  it('matches whole words and phrases only', () => {
    expect(containsTerm('Migrated services to Kubernetes.', 'kubernetes')).toBe(true);
    expect(containsTerm('Used Javascript daily', 'Java')).toBe(false);
    expect(containsTerm('Built event-driven systems', 'event driven')).toBe(true);
    expect(containsTerm('Wrote SQL reports', 'sql')).toBe(true);
  });

  it('stems both sides so inflections match', () => {
    expect(containsTerm('Mentored 5 engineers', 'mentoring')).toBe(true);
    expect(containsTerm('Backend engineer with 8 years', 'backend engineering')).toBe(true);
    expect(containsTerm('Designed distributed system', 'distributed systems')).toBe(true);
    expect(containsTerm('Improved processes', 'process')).toBe(true);
    expect(containsTerm('Led the team', 'leadership')).toBe(false);
  });

  it('finds the master skill by name or alias', () => {
    expect(findSkillForTerm(master, 'golang')?.skillId).toBe('sk_go');
    expect(findSkillForTerm(master, 'K8s')?.skillId).toBe('sk_k8s');
    expect(findSkillForTerm(master, 'Apache Kafka')?.skillId).toBe('sk_kafka');
    expect(findSkillForTerm(master, 'NextJS')?.skillId).toBe('sk_react');
    expect(findSkillForTerm(master, 'Rust')).toBeNull();
  });

  it('a JD term matches bullet text through the skill aliases and simple plurals', () => {
    const forms = termForms(master, 'Golang');
    expect(matchesAny('Built a Go gRPC pricing service', forms)).toBe(true);
    expect(matchesAny('Built microservices', termForms(master, 'microservice'))).toBe(true);
    expect(matchesAny('Migrated to EKS', termForms(master, 'Kubernetes'))).toBe(true);
  });
});

describe('keyword gaps', () => {
  const analysis: JdAnalysis = {
    title: 't',
    company: 'c',
    seniority: 'senior',
    domain: 'd',
    requiredSkills: ['Kubernetes', 'Golang', 'Terraform', 'Rust'],
    niceToHaves: ['Airflow', 'scikit-learn'],
    keywords: ['design docs', 'distributed systems'],
  };

  it('classifies covered / suggested / missing with suggestions pointing at real content', () => {
    const sel = defaultSelection(master, emptyJob(), 'j');
    // Hide Terraform skill and the Lumen role (which has the Airflow bullet).
    sel.skillIds = sel.skillIds.filter((id) => id !== 'sk_terraform' && id !== 'sk_airflow');
    sel.blocks.find((b) => b.refId === 'exp_lumen')!.included = false;
    // Give a bullet an alternate phrasing that mentions distributed systems.
    const m = structuredClone(master);
    m.experience[0]!.bullets[2]!.alternates = ['Built a distributed Go gRPC pricing service that reduced quote latency p99 from 900 ms to 120 ms.'];
    m.summaries[0]!.text = 'Backend engineer.';
    const byKey = Object.fromEntries(analyzeKeywordGaps(m, sel, analysis).map((k) => [k.keyword, k]));

    expect(byKey['Kubernetes']!.status).toBe('covered');
    expect(byKey['Golang']!.status).toBe('covered'); // via the Go alias in bullets
    expect(byKey['Terraform']!.status).toBe('suggested');
    expect(byKey['Terraform']!.suggestions[0]).toMatchObject({ kind: 'add-skill', skillId: 'sk_terraform' });
    expect(byKey['Airflow']!.status).toBe('suggested');
    expect(byKey['Airflow']!.suggestions.map((s) => s.kind)).toContain('include-bullet');
    expect(byKey['Rust']!).toMatchObject({ status: 'missing', suggestions: [] });
    expect(byKey['design docs']!.status).toBe('covered');
    expect(byKey['distributed systems']!.status).toBe('missing'); // the alternate says "distributed Go", not the phrase
    expect(byKey['scikit-learn']!.status).toBe('covered'); // skill shown
  });

  it("suggests the user's own alternate phrasing when it contains the term", () => {
    const sel = defaultSelection(master, emptyJob(), 'j');
    const m = structuredClone(master);
    m.summaries[0]!.text = 'Backend engineer.';
    m.experience[0]!.bullets[1]!.alternates = ['Designed an event-driven distributed systems pipeline on Kafka processing 30M events per day.'];
    const k = analyzeKeywordGaps(m, sel, { ...analysis, keywords: ['distributed systems'] }).find((x) => x.keyword === 'distributed systems')!;
    expect(k.status).toBe('suggested');
    expect(k.suggestions[0]).toMatchObject({ kind: 'use-alternate', bulletId: 'b_nw_2' });
  });
});
