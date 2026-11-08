export const STATUSES = ["Scheduled", "Ongoing", "Completed", "On Hold", "Cancelled"] as const;
export const OVERRIDES = ["", "On Hold", "Cancelled"] as const;

/** Today's date in India time as YYYY-MM-DD. */
export function todayIST(): string {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

export function normDate(d: unknown): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/** Status follows the dates unless the training is put On Hold or Cancelled. */
export function trainingStatus(t: { start_date?: unknown; end_date?: unknown; status_override?: string | null }): string {
  if (t.status_override) return t.status_override;
  const s = normDate(t.start_date);
  const e = normDate(t.end_date) || s;
  if (!s) return "Not scheduled";
  const today = todayIST();
  if (today < s) return "Scheduled";
  if (today > e) return "Completed";
  return "Ongoing";
}

/** Every training day between start and end (optionally skipping Sat/Sun). */
export function trainingDays(start: string, end: string, skipWeekends: boolean): string[] {
  if (!start) return [];
  const out: string[] = [];
  const last = end || start;
  const d = new Date(start + "T00:00:00Z");
  const stop = new Date(last + "T00:00:00Z");
  let guard = 0;
  while (d <= stop && guard++ < 400) {
    const wd = d.getUTCDay();
    if (!(skipWeekends && (wd === 0 || wd === 6))) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
