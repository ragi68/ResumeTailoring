// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { selectAdapter } from '@/lib/adapters';
import { captureJobDescription } from '@/lib/adapters/capture';

function load(file: string, url: string): Document {
  const html = fs.readFileSync(path.resolve('fixtures', file), 'utf8');
  // Scripts don't run: we test the static markup the adapters see.
  return new JSDOM(html, { url }).window.document;
}

describe('adapter selection by hostname', () => {
  it.each([
    ['jobs.lever.co', 'lever'],
    ['job-boards.greenhouse.io', 'greenhouse'],
    ['boards.greenhouse.io', 'greenhouse'],
    ['jobs.ashbyhq.com', 'ashby'],
    ['acme.wd5.myworkdayjobs.com', 'workday'],
    ['careers.example.com', 'generic'],
    ['notlever.co', 'generic'],
  ])('%s -> %s', (host, name) => {
    expect(selectAdapter(host).name).toBe(name);
  });
});

describe('Lever', () => {
  const url = 'https://jobs.lever.co/northstar/123/apply';
  const doc = load('lever.html', url);
  const adapter = selectAdapter('jobs.lever.co');

  it('captures the JD from site selectors, excluding the application form', () => {
    const jd = captureJobDescription(doc, adapter)!;
    expect(jd.source).toBe('site');
    expect(jd.title).toBe('Senior Backend Engineer');
    expect(jd.company).toBe('Northstar Freight');
    expect(jd.url).toBe(url);
    expect(jd.text).toContain('Strong Golang and Kubernetes');
    expect(jd.text).toContain('remote-first culture');
    expect(jd.text).not.toContain('Submit your application');
    expect(jd.text).not.toContain('Full name');
  });

  it('finds the resume input', async () => {
    const t = await adapter.findUploadTarget(doc);
    expect(t?.kind).toBe('input');
    expect(t?.el.id).toBe('resume-upload-input');
  });
});

describe('Greenhouse', () => {
  const doc = load('greenhouse.html', 'https://job-boards.greenhouse.io/larkspur/jobs/42');
  const adapter = selectAdapter('job-boards.greenhouse.io');

  it('captures title, company and description', () => {
    const jd = captureJobDescription(doc, adapter)!;
    expect(jd).toMatchObject({ source: 'site', title: 'Staff Data Engineer', company: 'Larkspur Health' });
    expect(jd.text).toContain('Orchestrate workflows with Airflow');
    expect(jd.text).toMatch(/• Build and own batch/);
  });

  it('picks the hidden #resume input, not the cover letter', async () => {
    const t = await adapter.findUploadTarget(doc);
    expect(t?.el.id).toBe('resume');
  });
});

describe('Ashby', () => {
  const doc = load('ashby.html', 'https://jobs.ashbyhq.com/quillmate/abc/application');
  const adapter = selectAdapter('jobs.ashbyhq.com');

  it('prefers JSON-LD over the site selectors', () => {
    const jd = captureJobDescription(doc, adapter)!;
    expect(jd).toMatchObject({ source: 'json-ld', title: 'Product Engineer, Growth', company: 'Quillmate' });
    expect(jd.text).toContain('• Ship full-stack features in React, TypeScript and Node.js');
    expect(jd.text).not.toMatch(/<\/?\w+>/);
  });

  it('site selectors alone still work', () => {
    const site = adapter.getJobDescription(doc)!;
    expect(site.title).toBe('Product Engineer, Growth');
    expect(site.company).toBe('Quillmate');
    expect(site.text).toContain('50,000 teams');
  });

  it('finds the resume system field', async () => {
    const t = await adapter.findUploadTarget(doc);
    expect(t?.el.id).toBe('_systemfield_resume');
  });
});

describe('Workday', () => {
  const adapter = selectAdapter('cobalt.wd5.myworkdayjobs.com');

  it('captures the JD via data-automation-id', () => {
    const doc = load('workday.html', 'https://cobalt.wd5.myworkdayjobs.com/en-US/careers/job/Denver/SRE-III_R123');
    const jd = captureJobDescription(doc, adapter)!;
    expect(jd).toMatchObject({ source: 'site', title: 'Site Reliability Engineer III', company: 'Cobalt Energy' });
    expect(jd.text).toContain('Kubernetes, AWS, Terraform, CI/CD');
  });

  it('waits for the upload step to render (MutationObserver)', async () => {
    const doc = load('workday.html', 'https://cobalt.wd5.myworkdayjobs.com/x');
    expect(await adapter.findUploadTarget(doc)).toBeNull();
    setTimeout(() => {
      doc.getElementById('app-step')!.innerHTML =
        '<div data-automation-id="file-upload-drop-zone"><input type="file" data-automation-id="file-upload-input-ref"></div>';
    }, 50);
    const t = await adapter.findUploadTarget(doc, { waitMs: 2000 });
    expect(t?.kind).toBe('input');
    expect(t?.el.getAttribute('data-automation-id')).toBe('file-upload-input-ref');
  });

  it('gives up after the wait if the step never appears', async () => {
    const doc = load('workday.html', 'https://cobalt.wd5.myworkdayjobs.com/x');
    expect(await adapter.findUploadTarget(doc, { waitMs: 100 })).toBeNull();
  });
});

describe('Generic', () => {
  const doc = load('generic-jsonld.html', 'https://careers.brightline.example/jobs/ml');
  const adapter = selectAdapter('careers.brightline.example');

  it('reads a JobPosting inside @graph, skipping broken JSON-LD, decoding double-escaped HTML', () => {
    const jd = captureJobDescription(doc, adapter)!;
    expect(jd).toMatchObject({ source: 'json-ld', title: 'Machine Learning Engineer', company: 'Brightline Labs' });
    expect(jd.text).toContain('Brightline Labs builds forecasting tools');
    expect(jd.text).toContain('• Deploy models behind FastAPI on AWS');
    expect(jd.text).not.toContain('<p>');
  });

  it('finds the CV input', async () => {
    const t = await adapter.findUploadTarget(doc);
    expect(t?.el.id).toBe('cv');
  });

  it('selection mode returns only the selected text', () => {
    const p = doc.createElement('p');
    p.textContent = 'Selected: we need a senior Go engineer who loves Kafka and distributed systems.';
    doc.body.appendChild(p);
    const range = doc.createRange();
    range.selectNodeContents(p);
    doc.getSelection()!.removeAllRanges();
    doc.getSelection()!.addRange(range);
    const jd = captureJobDescription(doc, adapter, 'selection')!;
    expect(jd.source).toBe('selection');
    expect(jd.text).toContain('senior Go engineer');
    doc.getSelection()!.removeAllRanges();
    expect(captureJobDescription(doc, adapter, 'selection')).toBeNull();
  });
});
