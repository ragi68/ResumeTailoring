// Shared helper: launch Playwright's Chromium with a built extension loaded unpacked.
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export async function launchWithExtension({ extDir = '.output/chrome-mv3', headless = true } = {}) {
  const dir = path.resolve(extDir);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error(`No build at ${dir}. Run the build first.`);
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;
  return { context, sw, extensionId };
}
