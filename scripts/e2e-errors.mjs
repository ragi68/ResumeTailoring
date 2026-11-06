// Error states: no API key, API key rejected (401), no job page / unreachable page.
//   npm run build:e2e && node scripts/e2e-errors.mjs
import { launchWithExtension } from './launch.mjs';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { context, extensionId } = await launchWithExtension({ extDir: '.output/chrome-mv3-e2e' });
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
await context.route('https://api.anthropic.com/v1/messages', (route) =>
  route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) }),
);

const panel = await context.newPage();
await panel.setViewportSize({ width: 420, height: 900 });
await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
await panel.click('[data-testid="new-job"]');
await panel.fill('textarea', 'We are hiring a senior Go engineer with Kubernetes and Kafka experience to build distributed systems.');

// No key yet
await panel.waitForSelector('text=Add your Anthropic API key');
check(await panel.isDisabled('[data-testid="tailor"]'), 'tailor disabled and banner shown without an API key');

// Rejected key
await panel.evaluate(() => chrome.storage.local.set({ anthropicApiKey: 'sk-ant-bad' }));
await panel.waitForFunction(() => !document.querySelector('[data-testid="tailor"]')?.hasAttribute('disabled'));
await panel.click('[data-testid="tailor"]');
await panel.waitForSelector('[data-testid="tailor-error"]', { timeout: 20000 });
const err = await panel.textContent('[data-testid="tailor-error"]');
check(/API key was rejected \(401\)/.test(err), `401 shown: ${err}`);

// Capture with the panel itself as the only tab: no job page
await panel.click('[data-testid="capture-jd"]');
await panel.waitForSelector('[data-testid="capture-status"]');
const cap = await panel.textContent('[data-testid="capture-status"]');
check(/No job page found|Could not reach/.test(cap), `capture without a job page: ${cap}`);

await context.close();
process.exit(failures ? 1 : 0);
