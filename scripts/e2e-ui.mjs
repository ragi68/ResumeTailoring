// UI e2e: new job -> PDF preview renders -> edit blocks -> ATS text -> fit to page -> expanded tab sync.
//   npm run build && node scripts/e2e-ui.mjs
import { launchWithExtension } from './launch.mjs';

const { context, extensionId } = await launchWithExtension();
const base = `chrome-extension://${extensionId}`;
const errors = [];
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const panel = await context.newPage();
panel.on('pageerror', (e) => errors.push(String(e)));
panel.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await panel.setViewportSize({ width: 420, height: 900 });
await panel.goto(`${base}/sidepanel.html`);
await panel.click('[data-testid="new-job"]');
await panel.fill('label.field:has-text("Company") input', 'Acme Robotics');

await panel.click('[data-testid="tab-preview"]');
await panel.waitForSelector('[data-testid="pdf-preview"] canvas', { timeout: 20000 });
const canvases = await panel.locator('[data-testid="pdf-preview"] canvas').count();
check(canvases >= 1, `preview rendered ${canvases} page canvas(es)`);
const fitBefore = await panel.textContent('[data-testid="fit-indicator"]');
console.log('     fit before:', fitBefore);

await panel.click('[data-testid="ats-toggle"]');
const ats = await panel.textContent('[data-testid="ats-text"]');
check(ats.includes('Experience') && ats.includes('Northwind Logistics') && ats.includes('•'), 'ATS text view shows extracted text');

// Fit to one page
await panel.click('button:has-text("Fit to 1 page")');
await panel.waitForFunction(() => document.querySelector('[data-testid="fit-indicator"]')?.textContent?.includes('Fits on 1 page'), null, { timeout: 30000 });
check(true, 'fit to page -> "Fits on 1 page"');

// Edit tab: exclude a role, reorder roles with arrows
await panel.click('[data-testid="tab-edit"]');
const firstRole = async () => (await panel.locator('.block .block-title').first().textContent()).trim();
const before = await firstRole();
await panel.locator('button[aria-label^="Move Senior Software Engineer"][aria-label$="down"]').first().click();
await panel.waitForTimeout(100);
const after = await firstRole();
check(before !== after, `arrow reorder moved first role (${before.slice(0, 30)} -> ${after.slice(0, 30)})`);

// Expanded tab sees the same state
const wide = await context.newPage();
wide.on('pageerror', (e) => errors.push(String(e)));
await wide.setViewportSize({ width: 1400, height: 900 });
await wide.goto(`${base}/sidepanel.html?view=tab`);
await wide.click('[data-testid="tab-edit"]');
await wide.waitForSelector('.block .block-title');
const wideFirst = (await wide.locator('.block .block-title').first().textContent()).trim();
check(wideFirst === after, 'expanded tab shows the same order');
await wide.waitForSelector('[data-testid="pdf-preview"] canvas', { timeout: 20000 });
check(true, 'expanded tab renders preview alongside the editor');

// Change in the wide tab propagates back to the panel
await wide.locator('.block input[type="checkbox"]').first().uncheck();
await panel.waitForTimeout(800);
const panelChecked = await panel.locator('.block input[type="checkbox"]').first().isChecked();
check(panelChecked === false, 'include toggle in expanded tab synced to side panel');

// Drag-and-drop reorder with the mouse (dnd-kit)
const handles = wide.locator('.block .handle');
const h0 = await handles.nth(0).boundingBox();
const h1 = await handles.nth(1).boundingBox();
const titleBefore = (await wide.locator('.block .block-title').first().textContent()).trim();
await wide.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2);
await wide.mouse.down();
await wide.mouse.move(h0.x + h0.width / 2, h0.y + 20, { steps: 5 });
await wide.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2 + 30, { steps: 10 });
await wide.mouse.up();
await wide.waitForTimeout(300);
const titleAfter = (await wide.locator('.block .block-title').first().textContent()).trim();
check(titleBefore !== titleAfter, 'drag-and-drop reordered roles');

if (process.env.SHOTS) { await panel.click('[data-testid="tab-edit"]'); await panel.locator('button[aria-label="Show bullets"]').first().click(); await panel.screenshot({ path: process.env.SHOTS + '/panel-edit.png' }); await wide.screenshot({ path: process.env.SHOTS + '/wide.png' }); }
check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
await context.close();
process.exit(failures ? 1 : 0);
