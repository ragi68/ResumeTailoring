// Tailoring e2e with the Anthropic API mocked at the network layer (no real key or network use).
// Lever fixture -> capture JD -> Analyze & tailor -> auto-fit -> keyword chips -> rewrites -> attach.
//   npm run build:e2e && node scripts/e2e-tailor.mjs
import fs from 'node:fs';
import { launchWithExtension } from './launch.mjs';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { context, extensionId } = await launchWithExtension({ extDir: '.output/chrome-mv3-e2e' });
const base = `chrome-extension://${extensionId}`;
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const fx = (n) => fs.readFileSync(`fixtures/analysis/${n}`, 'utf8');

const apiCalls = [];
await context.route('https://api.anthropic.com/v1/messages', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
  const body = JSON.parse(req.postData() ?? '{}');
  const headers = req.headers();
  apiCalls.push({ model: body.model, system: body.system.slice(0, 40), browserHeader: headers['anthropic-dangerous-direct-browser-access'] });
  const text = body.system.startsWith('You extract') ? fx('lever.analysis.json') : body.system.startsWith('You tailor') ? fx('lever.select.json') : fx('lever.rewrites.json');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  });
});
const LEVER = 'https://jobs.lever.co/northstar/1234/apply';
await context.route(LEVER, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync('fixtures/lever.html', 'utf8') }));

const errors = [];
const panel = await context.newPage();
panel.on('pageerror', (e) => errors.push(String(e)));
await panel.setViewportSize({ width: 1400, height: 1000 });
await panel.goto(`${base}/sidepanel.html?view=tab`);
await panel.evaluate(() => chrome.storage.local.set({ anthropicApiKey: 'sk-ant-e2e-fake' }));

const job = await context.newPage();
await job.goto(LEVER);
await job.bringToFront();
await job.waitForTimeout(400);
await panel.bringToFront();
await panel.click('[data-testid="new-job"]');
await panel.click('[data-testid="capture-jd"]');
await panel.waitForSelector('[data-testid="capture-status"]');

await panel.click('[data-testid="tailor"]');
await panel.waitForFunction(
  () => document.querySelector('[data-testid="tailor-step"]')?.textContent?.startsWith('Tailored') || document.querySelector('[data-testid="tailor-error"]'),
  null,
  { timeout: 30000 },
);
const tailorErr = await panel.$('[data-testid="tailor-error"]');
check(!tailorErr, `tailoring finished${tailorErr ? `: ${await tailorErr.textContent()}` : ''}`);
check(apiCalls.length === 2 && apiCalls[0].model === 'claude-haiku-5-5' && apiCalls[1].model === 'claude-sonnet-5-5', `API calls: ${JSON.stringify(apiCalls)}`);
check(apiCalls.every((c) => c.browserHeader === 'true'), 'direct-browser-access header sent');
check(!!(await panel.$('[data-testid="analysis"]')), 'analysis summary shown');

await panel.waitForFunction(() => document.querySelector('[data-testid="fit-indicator"]')?.textContent?.includes('Fits on 1 page'), null, { timeout: 30000 }).catch(() => {});
check((await panel.textContent('[data-testid="fit-indicator"]')).includes('Fits on 1 page'), `auto-fit: ${await panel.textContent('[data-testid="fit-indicator"]')}`);

await panel.click('summary:has-text("Notes from tailoring")');
const notes = await panel.textContent('details:has(summary:has-text("Notes from tailoring"))');
check(notes.includes('b_fake_99') && notes.includes('Rust'), 'repair notes list dropped ids');

await panel.click('[data-testid="tab-edit"]');
const firstRole = (await panel.locator('.block .block-title').first().textContent()).trim();
check(firstRole.startsWith('Senior Software Engineer, Northwind'), `first role: ${firstRole}`);

const ats = await panel.evaluate(async () => {
  document.querySelector('[data-testid="ats-toggle"]').click();
  await new Promise((r) => setTimeout(r, 300));
  return document.querySelector('[data-testid="ats-text"]')?.textContent ?? '';
});
check(!ats.includes('Rust') && ats.includes('Kafka'), 'ATS text has Kafka and no invented Rust skill');

// Keywords tab
await panel.click('[data-testid="tab-keywords"]');
await panel.waitForSelector('[data-testid="keyword-chips"]', { timeout: 5000 }).catch(() => {});
const chips = await panel.$$eval('[data-testid="keyword-chips"] .chip', (els) => els.map((e) => `${e.className.replace('chip ', '')}:${e.textContent}`));
console.log('     chips:', chips.join(' | '));
check(chips.some((c) => c.startsWith('covered:') && c.includes('Kafka')), 'Kafka chip covered');
check(chips.some((c) => c.startsWith('missing:') && c.includes('Rust')), 'Rust chip missing (no supported place)');

// Rewrites
const rw = await panel.$('[data-testid="suggest-rewrites"]');
if (rw) {
  await rw.click();
  await panel.waitForSelector('[data-testid="rewrite-card"]', { timeout: 20000 }).catch(() => {});
  const cards = await panel.$$('[data-testid="rewrite-card"]');
  check(cards.length === 1, `one honest rewrite suggested (got ${cards.length})`);
  if (cards.length) {
    await panel.click('[data-testid="rewrite-accept"]');
    await panel.waitForTimeout(800);
    const ats2 = await panel.evaluate(async () => {
      document.querySelector('[data-testid="ats-toggle"]').click();
      await new Promise((r) => setTimeout(r, 600));
      return document.querySelector('[data-testid="ats-text"]')?.textContent ?? '';
    });
    check(ats2.includes('Golang gRPC'), 'accepted rewrite appears in the PDF text');
  }
} else check(false, 'suggest-rewrites button present');

// Attach the tailored resume
await job.bringToFront();
await job.waitForTimeout(200);
await panel.bringToFront();
await panel.click('[data-testid="attach-resume"]');
await panel.waitForSelector('[data-testid="attach-result"]:not(:has-text("Attaching"))', { timeout: 20000 });
const attachMsg = await panel.textContent('[data-testid="attach-result"]');
const pageRes = await job.textContent('#result');
check(pageRes.includes('Alex Rivera Resume - Northstar Freight.pdf') && pageRes.includes('%PDF-'), `attached: ${attachMsg} | page: ${pageRes}`);
check((await job.evaluate(() => document.body.dataset.submitted)) !== 'true', 'application not submitted');

check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
if (process.env.SHOTS) await panel.screenshot({ path: `${process.env.SHOTS}/tailored.png` });
await context.close();
process.exit(failures ? 1 : 0);
