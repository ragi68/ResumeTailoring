import { genericAdapter } from './generic';
import { ashbyAdapter, greenhouseAdapter, leverAdapter, workdayAdapter } from './sites';
import type { SiteAdapter } from './types';

const hostIs = (suffix: string) => (h: string) => h === suffix || h.endsWith(`.${suffix}`);

const registry: { test: (hostname: string) => boolean; adapter: SiteAdapter }[] = [
  { test: hostIs('lever.co'), adapter: leverAdapter },
  { test: hostIs('greenhouse.io'), adapter: greenhouseAdapter },
  { test: hostIs('ashbyhq.com'), adapter: ashbyAdapter },
  { test: hostIs('myworkdayjobs.com'), adapter: workdayAdapter },
];

/** Pick the adapter for a hostname; the generic adapter is the default. */
export function selectAdapter(hostname: string): SiteAdapter {
  return registry.find((e) => e.test(hostname))?.adapter ?? genericAdapter;
}
