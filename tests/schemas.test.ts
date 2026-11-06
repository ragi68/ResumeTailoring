import { describe, expect, it } from 'vitest';
import { MasterResumeSchema, allMasterIds } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { PARSERS, parseMasterImport } from '@/lib/storage';
import { fileNameFromPattern, formatRange } from '@/lib/text';

describe('seed master', () => {
  it('validates against the schema', () => {
    expect(MasterResumeSchema.safeParse(SEED_MASTER).success).toBe(true);
  });
  it('has globally unique ids', () => {
    const ids = allMasterIds(SEED_MASTER);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('master import', () => {
  it('round-trips export JSON', () => {
    const r = parseMasterImport(JSON.stringify(SEED_MASTER));
    expect(r.ok).toBe(true);
  });
  it('rejects duplicate ids', () => {
    const bad = structuredClone(SEED_MASTER);
    bad.experience[1]!.bullets[0]!.id = bad.experience[0]!.bullets[0]!.id;
    const r = parseMasterImport(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Duplicate id/);
  });
  it('rejects bad dates and non-JSON', () => {
    const bad = structuredClone(SEED_MASTER) as unknown as { experience: { start: string }[] };
    bad.experience[0]!.start = 'March 2021';
    expect(parseMasterImport(JSON.stringify(bad)).ok).toBe(false);
    expect(parseMasterImport('{nope').ok).toBe(false);
  });
});

describe('storage parsers', () => {
  it('falls back to the seed when nothing is stored', () => {
    expect(PARSERS.master(undefined).value.header.name).toBe(SEED_MASTER.header.name);
  });
  it('merges partial settings over defaults', () => {
    const r = PARSERS.settings({ pageLimit: 2 });
    expect(r.error).toBeUndefined();
    expect(r.value.pageLimit).toBe(2);
    expect(r.value.tailorModel).toBe('claude-sonnet-5-5');
  });
  it('keeps valid saved selections and skips corrupt ones', () => {
    const r = PARSERS.selections({ a: { nope: true } });
    expect(r.value).toEqual({});
    expect(r.error).toMatch(/1 saved job/);
  });
});

describe('text helpers', () => {
  it('formats date ranges consistently', () => {
    expect(formatRange('2021-03', 'present')).toBe('Mar 2021 – Present');
    expect(formatRange('', '2016-06')).toBe('Jun 2016');
  });
  it('builds safe file names', () => {
    expect(fileNameFromPattern('{name} Resume - {company}.pdf', { name: 'Alex Rivera', company: 'Acme/Co' })).toBe('Alex Rivera Resume - AcmeCo.pdf');
    expect(fileNameFromPattern('{name} Resume - {company}.pdf', { name: 'Alex', company: '' })).toBe('Alex Resume.pdf');
  });
});
