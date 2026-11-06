/**
 * Site adapters for the ATSs we know. Selectors reflect each site's markup at the time of writing
 * (see fixtures/); every adapter falls back to the generic finder so markup drift degrades gracefully.
 */
import { elementText, cleanText } from './capture';
import { attachToTarget, bestFileInput, findDropZone, findFileInputs, normalizeSpace, setInputFiles, simulateDrop, waitFor } from './dom';
import { genericFindTarget } from './generic';
import type { AttachOutcome, FindOptions, SiteAdapter, SiteJobDescription, UploadTarget } from './types';

const text = (doc: Document, sel: string) => normalizeSpace(doc.querySelector(sel)?.textContent ?? '');

function firstText(doc: Document, selectors: string[]): string {
  for (const s of selectors) {
    const t = text(doc, s);
    if (t) return t;
  }
  return '';
}

function joinSections(els: Element[]): string {
  return cleanText(els.map((e) => elementText(e)).join('\n\n'));
}

/** "Senior Engineer - Acme" / "Acme - Senior Engineer" / "Job Application for X at Acme" */
function companyFromTitle(title: string, jobTitle: string): string {
  const at = title.match(/\bat\s+(.+?)\s*$/i);
  if (at?.[1]) return at[1].trim();
  const parts = title.split(/\s+[-–|@]\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => p !== jobTitle && !/jobs?|careers?|lever|greenhouse|ashby|workday/i.test(p)) ?? '';
}

function inputTarget(input: HTMLInputElement | null, label: string): UploadTarget | null {
  return input ? { kind: 'input', el: input, score: 20, label } : null;
}

async function attachWith(adapter: SiteAdapter, file: File, doc: Document, opts?: FindOptions): Promise<AttachOutcome> {
  const target = await adapter.findUploadTarget(doc, opts);
  if (!target) return { ok: false, adapter: adapter.name, verified: false, detail: 'No resume upload field found on this page' };
  return attachToTarget(target, file, adapter.name);
}

// ---------------- Lever ----------------

export const leverAdapter: SiteAdapter = {
  name: 'lever',
  getJobDescription(doc): SiteJobDescription | null {
    const title = firstText(doc, ['.posting-headline h2', '[data-qa="posting-name"]', '.posting-header h2']);
    const sections = Array.from(doc.querySelectorAll('.posting-page .section-wrapper .section, [data-qa="job-description"], [data-qa="closing-description"]'))
      .filter((s) => !s.closest('.application-form, form') && !s.querySelector('.postings-btn, a[href*="/apply"]'))
      .filter((s, i, arr) => !arr.some((o, j) => j !== i && o.contains(s)));
    const body = joinSections(sections);
    if (!body) return null;
    const logoAlt = doc.querySelector('.main-header-logo img')?.getAttribute('alt')?.replace(/\s*logo\s*$/i, '') ?? '';
    return { title, company: logoAlt || companyFromTitle(doc.title, title), text: body };
  },
  async findUploadTarget(doc, opts) {
    return waitFor(
      doc,
      () => inputTarget(doc.querySelector<HTMLInputElement>('input[type="file"][name="resume"], #resume-upload-input'), 'Lever resume') ?? genericFindTarget(doc),
      opts?.waitMs ?? 0,
    );
  },
  attachFile(file, doc, opts) {
    return attachWith(leverAdapter, file, doc, opts);
  },
};

// ---------------- Greenhouse ----------------

export const greenhouseAdapter: SiteAdapter = {
  name: 'greenhouse',
  getJobDescription(doc): SiteJobDescription | null {
    const title = firstText(doc, ['.job__title h1', 'h1.section-header', '#header .app-title', '.app-title', 'h1']);
    const desc = doc.querySelector('.job__description, #content .job-post-content, #content, .job-post');
    if (!desc) return null;
    const body = elementText(desc);
    const company =
      firstText(doc, ['#header .company-name']).replace(/^at\s+/i, '') ||
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
      companyFromTitle(doc.title, title);
    return body ? { title, company, text: body } : null;
  },
  async findUploadTarget(doc, opts) {
    const probe = () =>
      inputTarget(
        doc.querySelector<HTMLInputElement>(
          // New job boards: hidden #resume input behind an "Attach" button. Old boards: S3 upload form.
          'input#resume[type="file"], input[type="file"][id*="resume" i], #resume_fieldset input[type="file"], form#s3_upload_for_resume input[type="file"]',
        ),
        'Greenhouse resume',
      ) ?? genericFindTarget(doc);
    return waitFor(doc, probe, opts?.waitMs ?? 0);
  },
  attachFile(file, doc, opts) {
    return attachWith(greenhouseAdapter, file, doc, opts);
  },
};

// ---------------- Ashby ----------------

function ashbyResumeInput(doc: Document): HTMLInputElement | null {
  const direct = doc.querySelector<HTMLInputElement>('input[type="file"]#_systemfield_resume, input[type="file"][name="_systemfield_resume"]');
  if (direct) return direct;
  const entries = Array.from(doc.querySelectorAll('.ashby-application-form-field-entry, [class*="fieldEntry"]'));
  for (const entry of entries) {
    const label = normalizeSpace(entry.querySelector('label')?.textContent ?? '');
    if (/resume|cv/i.test(label)) {
      const input = entry.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) return input;
    }
  }
  const best = bestFileInput(findFileInputs(doc));
  return best?.kind === 'input' ? best.el : null;
}

export const ashbyAdapter: SiteAdapter = {
  name: 'ashby',
  getJobDescription(doc): SiteJobDescription | null {
    const title = firstText(doc, ['.ashby-job-posting-heading', 'h1[class*="_title"]', 'h1']);
    const desc = doc.querySelector('.ashby-job-posting-description, [class*="_descriptionText"], [class*="descriptionText"]');
    if (!desc) return null;
    return { title, company: companyFromTitle(doc.title, title), text: elementText(desc) };
  },
  async findUploadTarget(doc, opts) {
    return waitFor(
      doc,
      () => {
        const input = ashbyResumeInput(doc);
        if (input) return { kind: 'input' as const, el: input, score: 20, label: 'Ashby resume' };
        return findDropZone(doc);
      },
      opts?.waitMs ?? 0,
    );
  },
  async attachFile(file, doc, opts) {
    const target = await ashbyAdapter.findUploadTarget(doc, opts);
    if (!target) return { ok: false, adapter: 'ashby', verified: false, detail: 'No resume upload field found on this page' };
    if (target.kind === 'dropzone') return attachToTarget(target, file, 'ashby');
    const verified = setInputFiles(target.el, file);
    // Ashby's upload zone is React-controlled; if its state didn't pick up the change event,
    // also drop the file on the zone that wraps the input.
    const zone = target.el.closest<HTMLElement>('[class*="_fileUpload"], [class*="dropzone" i], .ashby-application-form-field-entry');
    if (!verified && zone) simulateDrop(zone, file);
    return {
      ok: true,
      method: 'input',
      adapter: 'ashby',
      verified,
      detail: verified ? 'Attached to the Ashby resume field' : 'Set the resume field and dropped the file on its upload zone; check that the page shows it',
    };
  },
};

// ---------------- Workday ----------------

const WD = {
  input: 'input[type="file"][data-automation-id="file-upload-input-ref"], [data-automation-id="attachments-FileUpload"] input[type="file"], [data-automation-id="resumeAttachments"] input[type="file"]',
  zone: '[data-automation-id="file-upload-drop-zone"]',
};

function workdayTarget(doc: Document): UploadTarget | null {
  const input = doc.querySelector<HTMLInputElement>(WD.input);
  if (input) return { kind: 'input', el: input, score: 20, label: 'Workday resume' };
  const zone = doc.querySelector<HTMLElement>(WD.zone);
  if (zone) return { kind: 'dropzone', el: zone, score: 15, label: 'Workday drop zone' };
  return null;
}

export const workdayAdapter: SiteAdapter = {
  name: 'workday',
  getJobDescription(doc): SiteJobDescription | null {
    const desc = doc.querySelector('[data-automation-id="jobPostingDescription"]');
    if (!desc) return null;
    const title = firstText(doc, ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id]', 'h1']);
    const host = doc.location?.hostname ?? '';
    const tenant = host.split('.')[0] ?? '';
    const company = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || companyFromTitle(doc.title, title) || tenant;
    return { title, company, text: elementText(desc) };
  },
  /** Workday is a multi-step SPA: the upload step renders later, so wait for it with a MutationObserver. */
  async findUploadTarget(doc, opts) {
    return waitFor(doc, () => workdayTarget(doc), opts?.waitMs ?? 0);
  },
  attachFile(file, doc, opts) {
    return attachWith(workdayAdapter, file, doc, opts);
  },
};
