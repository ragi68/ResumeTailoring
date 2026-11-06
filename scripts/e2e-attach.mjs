// End-to-end attach + JD capture in real Chromium with the unpacked e2e build.
//  1. Local test page (programmatic injection, generic adapter): plain, hidden, dropzone, iframe.
//  2. Fixture pages served at their real ATS URLs via request routing (static content script,
//     site adapters): Lever, Greenhouse, Ashby, Workday (delayed upload step).
//   npm run build:e2e && npm run e2e
import fs from 'node:fs';
import { launchWithExtension } from './launch.mjs';
import { startServer, PORT } from './serve-test-page.mjs';

const server = await startServer();
const { context, extensionId } = await launchWithExtension({ extDir: '.output/chrome-mv3-e2e' });
let failures = 0;
const report = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(12)} ${detail}`);
};

const FIXTURES = {
  lever: { url: 'https://jobs.lever.co/northstar/1234/apply', file: 'fixtures/lever.html', title: 'Senior Backend Engineer', company: 'Northstar Freight' },
  greenhouse: { url: 'https://job-boards.greenhouse.io/larkspur/jobs/42', file: 'fixtures/greenhouse.html', title: 'Staff Data Engineer', company: 'Larkspur Health' },
  ashby: { url: 'https://jobs.ashbyhq.com/quillmate/abc/application', file: 'fixtures/ashby.html', title: 'Product Engineer, Growth', company: 'Quillmate' },
  workday: { url: 'https://cobalt.wd5.myworkdayjobs.com/en-US/careers/job/Denver/SRE_R1', file: 'fixtures/workday.html', title: 'Site Reliability Engineer III', company: 'Cobalt Energy' },
};
for (const f of Object.values(FIXTURES)) {
  await context.route(f.url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(f.file, 'utf8') }));
}

const panel = await context.newPage();
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
const diag = await context.newPage();
await diag.goto(`chrome-extension://${extensionId}/options.html#settings`);
await diag.click('summary:has-text("Diagnostics")');

async function openTarget(url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront(); // background records it as the target tab
  await page.waitForTimeout(400);
  return page;
}

async function attachTestPdf() {
  await diag.bringToFront();
  await diag.click('[data-testid="attach-test-pdf"]');
  await diag.waitForFunction(() => {
    const t = document.querySelector('[data-testid="attach-status"]')?.textContent ?? '';
    return t !== '' && !t.startsWith('Working');
  }, null, { timeout: 30000 });
  return diag.textContent('[data-testid="attach-status"]');
}

async function pageResult(page) {
  await page.waitForFunction(() => document.getElementById('result')?.dataset.ok !== undefined, null, { timeout: 5000 }).catch(() => {});
  return { ok: (await page.getAttribute('#result', 'data-ok')) === 'true', text: await page.textContent('#result') };
}

// 1. Generic adapter on the local test page
for (const kase of ['plain', 'hidden', 'dropzone', 'iframe']) {
  const page = await openTarget(`http://localhost:${PORT}/attach-test.html?case=${kase}`);
  const status = await attachTestPdf();
  const r = await pageResult(page);
  report(r.ok, `local:${kase}`, `${status} | page: ${r.text}`);
  await page.close();
}

// 2. Site adapters on fixtures at real ATS URLs
await panel.bringToFront();
await panel.click('[data-testid="new-job"]');
for (const [name, f] of Object.entries(FIXTURES)) {
  const page = await openTarget(f.url);

  // JD capture through the panel UI
  await panel.bringToFront();
  await panel.click('[data-testid="capture-jd"]');
  await panel.waitForSelector('[data-testid="capture-status"]', { timeout: 15000 });
  const capStatus = await panel.textContent('[data-testid="capture-status"]');
  const title = await panel.inputValue('[data-testid="job-title"]');
  const company = await panel.inputValue('[data-testid="job-company"]');
  report(title === f.title && company === f.company && capStatus.startsWith('Captured'), `jd:${name}`, `${capStatus} | "${title}" @ "${company}"`);

  // Attach
  await page.bringToFront();
  await page.waitForTimeout(200);
  const status = await attachTestPdf();
  const r = await pageResult(page);
  const usedAdapter = status.includes(`[${name}/`);
  report(r.ok && usedAdapter, `attach:${name}`, `${status} | page: ${r.text}`);
  const submitted = await page.evaluate(() => document.body.dataset.submitted === 'true');
  if (submitted) report(false, `nosubmit:${name}`, 'form was submitted!');
  await page.close();
}

// 2b. Workday: attach immediately, before the upload step renders (adapter waits via MutationObserver).
{
  const page = await context.newPage();
  await page.goto(FIXTURES.workday.url);
  await page.bringToFront();
  const before = await page.evaluate(() => !!document.querySelector('[data-automation-id="file-upload-input-ref"]'));
  const status = await attachTestPdf();
  const r = await pageResult(page);
  report(!before && r.ok, 'attach:wd-wait', `upload step present at click: ${before} | ${status} | page: ${r.text}`);
  await page.close();
}

// 3. Company careers page (no host permission) embedding the Greenhouse form in an iframe.
const EMBED_TOP = 'https://careers.larkspur.example/jobs/42';
const EMBED_FRAME = 'https://job-boards.greenhouse.io/embed/job_app?for=larkspur&token=42';
await context.route(EMBED_TOP, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><title>Careers at Larkspur</title><h1>Careers</h1><div id="grnhse_app"><iframe id="grnhse_iframe" src="${EMBED_FRAME}" width="100%" height="900"></iframe></div>`,
  }),
);
await context.route(EMBED_FRAME, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync('fixtures/greenhouse.html', 'utf8') }));
{
  const page = await openTarget(EMBED_TOP);
  await page.waitForTimeout(500);
  await panel.bringToFront();
  await panel.click('[data-testid="new-job"]');
  await panel.click('[data-testid="capture-jd"]');
  await panel.waitForSelector('[data-testid="capture-status"]', { timeout: 15000 });
  const capStatus = await panel.textContent('[data-testid="capture-status"]');
  const title = await panel.inputValue('[data-testid="job-title"]');
  report(title === 'Staff Data Engineer' && capStatus.startsWith('Captured'), 'jd:gh-embed', `${capStatus} | "${title}"`);
  await page.bringToFront();
  const status = await attachTestPdf();
  const frame = page.frames().find((f) => f.url().startsWith('https://job-boards.greenhouse.io'));
  await frame.waitForFunction(() => document.getElementById('result')?.dataset.ok !== undefined, null, { timeout: 5000 }).catch(() => {});
  const ok = (await frame.getAttribute('#result', 'data-ok')) === 'true';
  report(ok && status.includes('[greenhouse/'), 'attach:gh-embed', `${status} | iframe: ${await frame.textContent('#result')}`);
  await page.close();
}

await context.close();
server.close();
process.exit(failures ? 1 : 0);
