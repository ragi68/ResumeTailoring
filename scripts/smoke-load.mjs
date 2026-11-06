// Smoke test: the unpacked build loads, pages render without errors, master edits persist and sync.
import { launchWithExtension } from './launch.mjs';

const { context, extensionId } = await launchWithExtension();
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));
const base = `chrome-extension://${extensionId}`;

const opts = await context.newPage();
watch(opts);
await opts.goto(`${base}/options.html`);
await opts.waitForSelector('text=Master resume');
const nameInput = opts.locator('label.field:has-text("Name") input').first();
await nameInput.waitFor();
console.log('seed name:', await nameInput.inputValue());

const other = await context.newPage();
watch(other);
await other.goto(`${base}/options.html`);
await other.locator('label.field:has-text("Name") input').first().waitFor();

await opts.bringToFront();
await nameInput.fill('Alex Q. Rivera');
await opts.waitForTimeout(600);
const synced = await other.locator('label.field:has-text("Name") input').first().inputValue();
console.log('synced to second page:', synced);
const stored = await opts.evaluate(async () => (await chrome.storage.local.get('master')).master.header.name);
console.log('persisted:', stored);

const panel = await context.newPage();
watch(panel);
await panel.goto(`${base}/sidepanel.html`);
await panel.waitForSelector('#root *');
console.log('page errors:', errors.length ? errors : 'none');
await context.close();
if (errors.length || synced !== 'Alex Q. Rivera' || stored !== 'Alex Q. Rivera') process.exit(1);
