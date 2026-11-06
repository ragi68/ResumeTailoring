/** Small text utilities shared across modules. */

/** Heuristic: does a bullet contain a quantified result (numbers, %, $, multipliers)? */
export function detectMetric(text: string): boolean {
  return /(\d|%|\$|\b(x|×)\d|\bhalf\b|\bdoubled\b|\btripled\b)/i.test(text);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2021-03" -> "Mar 2021"; "present" -> "Present". One consistent format everywhere. */
export function formatYearMonth(value: string): string {
  if (value === 'present') return 'Present';
  if (!value) return '';
  const [y, m] = value.split('-');
  const month = MONTHS[Number(m) - 1];
  return month && y ? `${month} ${y}` : value;
}

export function formatRange(start: string, end: string): string {
  const s = formatYearMonth(start);
  const e = formatYearMonth(end);
  return s ? `${s} – ${e}` : e;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Fill "{name} Resume - {company}.pdf" and strip characters that are invalid in file names. */
export function fileNameFromPattern(pattern: string, vars: Record<string, string>): string {
  let name = pattern.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  name = name
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+-\s*(\.pdf)$/i, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  return name === '.pdf' ? 'Resume.pdf' : name;
}
