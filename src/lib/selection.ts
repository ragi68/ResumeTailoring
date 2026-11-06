/**
 * The selection layer: a per-job view over the master (which blocks/bullets/skills are shown and
 * in what order). Nothing here mutates the master.
 */
import type {
  BlockType,
  Bullet,
  JobMeta,
  MasterResume,
  Selection,
  SelectionBlock,
} from './schemas';
import { formatRange } from './text';

// ---------------- lookups ----------------

export interface MasterIndex {
  blocks: Map<string, { type: BlockType; bulletIds: string[] }>;
  /** bullet id -> owning block id */
  bulletOwner: Map<string, string>;
  bullets: Map<string, Bullet>;
  skills: Map<string, { name: string; aliases: string[]; groupId: string }>;
  summaries: Set<string>;
}

export function indexMaster(master: MasterResume): MasterIndex {
  const blocks: MasterIndex['blocks'] = new Map();
  const bulletOwner = new Map<string, string>();
  const bullets = new Map<string, Bullet>();
  const add = (type: BlockType, id: string, bs: Bullet[]) => {
    blocks.set(id, { type, bulletIds: bs.map((b) => b.id) });
    for (const b of bs) {
      bulletOwner.set(b.id, id);
      bullets.set(b.id, b);
    }
  };
  master.experience.forEach((e) => add('experience', e.id, e.bullets));
  master.projects.forEach((p) => add('project', p.id, p.bullets));
  master.education.forEach((e) => add('education', e.id, []));
  const skills: MasterIndex['skills'] = new Map();
  master.skillGroups.forEach((g) => g.skills.forEach((s) => skills.set(s.id, { name: s.name, aliases: s.aliases, groupId: g.id })));
  return { blocks, bulletOwner, bullets, skills, summaries: new Set(master.summaries.map((s) => s.id)) };
}

function masterBlockOrder(master: MasterResume): { type: BlockType; id: string; bullets: string[] }[] {
  return [
    ...master.experience.map((e) => ({ type: 'experience' as const, id: e.id, bullets: e.bullets.map((b) => b.id) })),
    ...master.projects.map((p) => ({ type: 'project' as const, id: p.id, bullets: p.bullets.map((b) => b.id) })),
    ...master.education.map((e) => ({ type: 'education' as const, id: e.id, bullets: [] as string[] })),
  ];
}

export function allSkillIds(master: MasterResume): string[] {
  return master.skillGroups.flatMap((g) => g.skills.map((s) => s.id));
}

// ---------------- creation ----------------

export function emptyJob(): JobMeta {
  return { title: '', company: '', url: '', jdText: '', jdSource: 'manual', analysis: null, capturedAt: Date.now() };
}

/** Everything included in master order. The starting point before tailoring. */
export function defaultSelection(master: MasterResume, job: JobMeta, id: string): Selection {
  const now = Date.now();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    job,
    summaryId: master.summaries[0]?.id ?? null,
    blocks: masterBlockOrder(master).map((b) => ({
      type: b.type,
      refId: b.id,
      included: true,
      bullets: b.bullets.map((bid) => ({ id: bid, included: true })),
    })),
    skillIds: allSkillIds(master),
    textOverrides: {},
    origin: 'default',
    notes: [],
  };
}

/**
 * Reconcile a saved selection with the current master: drop references to deleted items and
 * append items added to the master since (excluded, so a saved tailoring doesn't silently grow).
 */
export function reconcileSelection(sel: Selection, master: MasterResume): Selection {
  const idx = indexMaster(master);
  const blocks: SelectionBlock[] = [];
  const seen = new Set<string>();
  for (const b of sel.blocks) {
    const m = idx.blocks.get(b.refId);
    if (!m || m.type !== b.type || seen.has(b.refId)) continue;
    seen.add(b.refId);
    const valid = new Set(m.bulletIds);
    const bullets = b.bullets.filter((r, i, arr) => valid.has(r.id) && arr.findIndex((x) => x.id === r.id) === i);
    const have = new Set(bullets.map((r) => r.id));
    for (const bid of m.bulletIds) if (!have.has(bid)) bullets.push({ id: bid, included: false });
    blocks.push({ ...b, bullets });
  }
  for (const mb of masterBlockOrder(master)) {
    if (!seen.has(mb.id)) {
      blocks.push({ type: mb.type, refId: mb.id, included: mb.type === 'education', bullets: mb.bullets.map((id) => ({ id, included: false })) });
    }
  }
  const skillIds = sel.skillIds.filter((id, i, arr) => idx.skills.has(id) && arr.indexOf(id) === i);
  const summaryId = sel.summaryId && idx.summaries.has(sel.summaryId) ? sel.summaryId : (master.summaries[0]?.id ?? null);
  const textOverrides = Object.fromEntries(Object.entries(sel.textOverrides).filter(([id]) => idx.bullets.has(id)));
  return { ...sel, blocks, skillIds, summaryId, textOverrides };
}

// ---------------- applying an LLM selection ----------------

/** Shape returned by the select step after ID validation/repair (see idRepair.ts). */
export interface ValidSelectionPlan {
  summaryId: string | null;
  blocks: { refId: string; bulletIds: string[] }[];
  skillIds: string[];
}

/**
 * Turn a validated plan into a Selection. Blocks the plan lists are included in plan order; the rest
 * are appended excluded. Within a block, planned bullets come first (included), then the rest (excluded).
 * Pinned items are always included. Education is always included unless the user removes it later.
 */
export function applyPlan(
  master: MasterResume,
  plan: ValidSelectionPlan,
  pins: readonly string[],
  base: Selection,
): Selection {
  const idx = indexMaster(master);
  const pinned = new Set(pins);
  const planned = new Map(plan.blocks.map((b) => [b.refId, b.bulletIds]));

  const toBlock = (type: BlockType, refId: string, includedByPlan: boolean): SelectionBlock => {
    const masterBullets = idx.blocks.get(refId)?.bulletIds ?? [];
    const chosen = (planned.get(refId) ?? []).filter((id) => masterBullets.includes(id));
    const chosenSet = new Set(chosen);
    const bullets = [
      ...chosen.map((id) => ({ id, included: true })),
      ...masterBullets.filter((id) => !chosenSet.has(id)).map((id) => ({ id, included: pinned.has(id) })),
    ];
    const hasPinnedBullet = bullets.some((b) => b.included && pinned.has(b.id));
    const included = includedByPlan || pinned.has(refId) || hasPinnedBullet || type === 'education';
    return { type, refId, included, bullets };
  };

  const blocks: SelectionBlock[] = [];
  const placed = new Set<string>();
  for (const pb of plan.blocks) {
    const m = idx.blocks.get(pb.refId);
    if (!m || placed.has(pb.refId)) continue;
    placed.add(pb.refId);
    blocks.push(toBlock(m.type, pb.refId, true));
  }
  for (const mb of masterBlockOrder(master)) {
    if (!placed.has(mb.id)) blocks.push(toBlock(mb.type, mb.id, false));
  }

  const skillIds = [...plan.skillIds.filter((id) => idx.skills.has(id))];
  for (const id of pins) if (idx.skills.has(id) && !skillIds.includes(id)) skillIds.push(id);

  return {
    ...base,
    updatedAt: Date.now(),
    summaryId: plan.summaryId && idx.summaries.has(plan.summaryId) ? plan.summaryId : base.summaryId,
    blocks,
    skillIds: [...new Set(skillIds)],
    origin: 'llm',
  };
}

/** Pinned blocks, bullets and skills are always included, whatever the selection says. */
export function applyPins(sel: Selection, pins: readonly string[], master: MasterResume): Selection {
  if (pins.length === 0) return sel;
  const pinned = new Set(pins);
  const idx = indexMaster(master);
  const blocks = sel.blocks.map((b) => {
    const bullets = b.bullets.map((r) => (pinned.has(r.id) && !r.included ? { ...r, included: true } : r));
    const included = b.included || pinned.has(b.refId) || bullets.some((r) => r.included && pinned.has(r.id));
    return included === b.included && bullets.every((r, i) => r === b.bullets[i]) ? b : { ...b, included, bullets };
  });
  const skillIds = [...sel.skillIds];
  for (const id of pins) if (idx.skills.has(id) && !skillIds.includes(id)) skillIds.push(id);
  return { ...sel, blocks, skillIds };
}

// ---------------- resolving for rendering ----------------

export interface ResolvedBullet {
  id: string;
  text: string;
  overridden: boolean;
}
export interface ResolvedEntry {
  id: string;
  type: BlockType;
  title: string;
  org: string;
  location: string;
  dates: string;
  links: string[];
  details: string;
  bullets: ResolvedBullet[];
}
export interface ResolvedResume {
  header: MasterResume['header'];
  summary: string;
  experience: ResolvedEntry[];
  projects: ResolvedEntry[];
  skills: { group: string; names: string[] }[];
  education: ResolvedEntry[];
}

export function resolveResume(master: MasterResume, sel: Selection): ResolvedResume {
  const idx = indexMaster(master);
  const exp = new Map(master.experience.map((e) => [e.id, e]));
  const proj = new Map(master.projects.map((p) => [p.id, p]));
  const edu = new Map(master.education.map((e) => [e.id, e]));
  const bullets = (b: SelectionBlock): ResolvedBullet[] =>
    b.bullets
      .filter((r) => r.included && idx.bullets.has(r.id))
      .map((r) => {
        const override = sel.textOverrides[r.id];
        return { id: r.id, text: override ?? idx.bullets.get(r.id)!.text, overridden: override !== undefined };
      });

  const out: ResolvedResume = {
    header: master.header,
    summary: master.summaries.find((s) => s.id === sel.summaryId)?.text ?? '',
    experience: [],
    projects: [],
    skills: [],
    education: [],
  };
  for (const b of sel.blocks) {
    if (!b.included) continue;
    if (b.type === 'experience') {
      const e = exp.get(b.refId);
      if (e) out.experience.push({ id: e.id, type: 'experience', title: e.title, org: e.company, location: e.location, dates: formatRange(e.start, e.end), links: [], details: '', bullets: bullets(b) });
    } else if (b.type === 'project') {
      const p = proj.get(b.refId);
      if (p) out.projects.push({ id: p.id, type: 'project', title: p.name, org: '', location: '', dates: '', links: p.links.map((l) => l.label || l.url).filter(Boolean), details: '', bullets: bullets(b) });
    } else {
      const e = edu.get(b.refId);
      if (e) out.education.push({ id: e.id, type: 'education', title: e.degree, org: e.school, location: e.location, dates: formatRange(e.start, e.end), links: [], details: e.details, bullets: [] });
    }
  }
  // Skills: grouped under their master group, groups in order of first appearance in the selection.
  const groupName = new Map(master.skillGroups.map((g) => [g.id, g.name]));
  const groups = new Map<string, string[]>();
  for (const id of sel.skillIds) {
    const s = idx.skills.get(id);
    if (!s) continue;
    const list = groups.get(s.groupId) ?? [];
    list.push(s.name);
    groups.set(s.groupId, list);
  }
  out.skills = [...groups].map(([gid, names]) => ({ group: groupName.get(gid) ?? 'Skills', names }));
  return out;
}

/** Plain-text rendering (clipboard fallback). Mirrors the PDF's structure and headings. */
export function resumeToPlainText(r: ResolvedResume): string {
  const lines: string[] = [];
  const h = r.header;
  lines.push(h.name);
  lines.push([h.location, h.email, h.phone, ...h.links.map((l) => l.label || l.url)].filter(Boolean).join(' | '));
  const section = (title: string) => lines.push('', title.toUpperCase());
  if (r.summary) {
    section('Summary');
    lines.push(r.summary);
  }
  const entries = (list: ResolvedEntry[]) => {
    for (const e of list) {
      lines.push('');
      lines.push([e.title, e.org].filter(Boolean).join(', ') + (e.links.length ? ` | ${e.links.join(' | ')}` : ''));
      const meta = [e.location, e.dates].filter(Boolean).join(' | ');
      if (meta) lines.push(meta);
      if (e.details) lines.push(e.details);
      for (const b of e.bullets) lines.push(`• ${b.text}`);
    }
  };
  if (r.experience.length) {
    section('Experience');
    entries(r.experience);
  }
  if (r.projects.length) {
    section('Projects');
    entries(r.projects);
  }
  if (r.skills.length) {
    section('Skills');
    for (const g of r.skills) lines.push(`${g.group}: ${g.names.join(', ')}`);
  }
  if (r.education.length) {
    section('Education');
    entries(r.education);
  }
  return lines.join('\n').trim() + '\n';
}

// ---------------- edit operations (used through useApp.mutateSelection) ----------------

export function moveInArray<T>(arr: T[], from: number, to: number): void {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item as T);
}

/** Move a block among blocks of the same type (the section order itself is fixed). */
export function moveBlockWithinType(sel: Selection, type: BlockType, fromIdx: number, toIdx: number): void {
  const positions = sel.blocks.map((b, i) => (b.type === type ? i : -1)).filter((i) => i >= 0);
  const typed = positions.map((p) => sel.blocks[p]!);
  moveInArray(typed, fromIdx, toIdx);
  positions.forEach((p, i) => (sel.blocks[p] = typed[i]!));
}
