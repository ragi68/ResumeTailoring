/** Hosts where content scripts are registered statically (in all frames). */
export const ATS_HOST_PATTERNS = [
  'https://*.lever.co/*',
  'https://*.greenhouse.io/*',
  'https://*.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*',
] as const;

export const ATS_HOST_SUFFIXES = ['lever.co', 'greenhouse.io', 'ashbyhq.com', 'myworkdayjobs.com'] as const;

export function isAtsHost(hostname: string): boolean {
  return ATS_HOST_SUFFIXES.some((s) => hostname === s || hostname.endsWith(`.${s}`));
}
