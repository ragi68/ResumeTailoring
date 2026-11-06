/**
 * Validate the model's selection against the master and repair what can be repaired.
 * Anything that doesn't map to real master content is dropped and reported. Nothing is invented.
 */
import { findSkillForTerm, normalizeTerm } from '../keywords';
import type { MasterResume } from '../schemas';
import { indexMaster, type ValidSelectionPlan } from '../selection';
import type { RawSelectPlan } from './prompts';

export interface RepairResult {
  plan: ValidSelectionPlan;
  issues: string[];
}

export function repairPlan(raw: RawSelectPlan, master: MasterResume): RepairResult {
  const idx = indexMaster(master);
  const issues: string[] = [];

  // Summary
  let summaryId: string | null = null;
  if (raw.summaryId) {
    if (idx.summaries.has(raw.summaryId)) summaryId = raw.summaryId;
    else {
      const byLabel = master.summaries.find((s) => normalizeTerm(s.label) === normalizeTerm(raw.summaryId ?? ''));
      if (byLabel) {
        summaryId = byLabel.id;
        issues.push(`Summary "${raw.summaryId}" mapped to "${byLabel.id}" by label.`);
      } else issues.push(`Dropped unknown summary id "${raw.summaryId}".`);
    }
  }

  // Blocks: resolve each refId to a real experience/project block.
  const nameToBlock = new Map<string, string>();
  master.experience.forEach((e) => nameToBlock.set(normalizeTerm(e.company), e.id));
  master.projects.forEach((p) => nameToBlock.set(normalizeTerm(p.name), p.id));

  const order: string[] = [];
  const bulletsByBlock = new Map<string, string[]>();
  const ensureBlock = (id: string) => {
    if (!bulletsByBlock.has(id)) {
      bulletsByBlock.set(id, []);
      order.push(id);
    }
    return bulletsByBlock.get(id)!;
  };

  for (const b of raw.blocks) {
    let refId: string | undefined = b.refId;
    const known = idx.blocks.get(refId);
    if (!known) {
      const owner = idx.bulletOwner.get(refId);
      const byName = nameToBlock.get(normalizeTerm(refId));
      refId = owner ?? byName;
      if (refId) issues.push(`Block "${b.refId}" mapped to "${refId}".`);
      else {
        issues.push(`Dropped unknown block id "${b.refId}".`);
        // Its bullets may still be real; they get re-homed below.
      }
    } else if (known.type === 'education') {
      continue; // education is always included; ignore
    }
    const list = refId ? ensureBlock(refId) : null;
    for (const bid of b.bulletIds) {
      const owner = idx.bulletOwner.get(bid);
      if (!owner) {
        issues.push(`Dropped unknown bullet id "${bid}".`);
        continue;
      }
      if (owner !== refId) {
        issues.push(`Bullet "${bid}" belongs to "${owner}", moved there.`);
        const ownerList = ensureBlock(owner);
        if (!ownerList.includes(bid)) ownerList.push(bid);
        continue;
      }
      if (list && !list.includes(bid)) list.push(bid);
    }
  }

  // Skills
  const skillIds: string[] = [];
  for (const sid of raw.skillIds) {
    let id: string | undefined = idx.skills.has(sid) ? sid : undefined;
    if (!id) {
      const match = findSkillForTerm(master, sid);
      if (match) {
        id = match.skillId;
        issues.push(`Skill "${sid}" mapped to "${match.skillId}" (${match.name}).`);
      } else issues.push(`Dropped skill "${sid}": not in your master resume.`);
    }
    if (id && !skillIds.includes(id)) skillIds.push(id);
  }

  const blocks = order.map((refId) => ({ refId, bulletIds: bulletsByBlock.get(refId)! }));
  for (const b of blocks) {
    if (b.bulletIds.length === 0 && idx.blocks.get(b.refId)!.bulletIds.length > 0) {
      issues.push(`"${b.refId}" was selected without bullets; its first bullet was added.`);
      b.bulletIds.push(idx.blocks.get(b.refId)!.bulletIds[0]!);
    }
  }
  if (blocks.length === 0) issues.push('The model selected no experience or projects.');
  return { plan: { summaryId, blocks, skillIds }, issues };
}
