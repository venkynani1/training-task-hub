import { q } from "@/lib/db";
import { ok, fail, s, d } from "@/lib/http";
import { trainingStatus, trainingDays, todayIST, applyCategoryRules } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await q<Record<string, any>>`
      SELECT t.id, t.name, COALESCE(t.category, 'Demand Based') AS category, t.trainer, t.requested_by, t.mode, t.location,
             t.start_date::text AS start_date, t.end_date::text AS end_date,
             t.start_time, t.end_time, t.skip_weekends, t.status_override, t.notes,
             (SELECT count(*)::int FROM participants p WHERE p.training_id = t.id) AS participants,
             (SELECT count(DISTINCT a.day)::int FROM attendance a WHERE a.training_id = t.id) AS days_marked
      FROM trainings t ORDER BY t.start_date NULLS LAST, t.id`;
    const today = todayIST();
    return ok(rows.map((r) => {
      const days = trainingDays(r.start_date || "", r.end_date || "", r.skip_weekends);
      const status = trainingStatus(r);
      return {
        ...r,
        status,
        total_days: days.length,
        attendance_due: status === "Ongoing" && days.includes(today),
      };
    }));
  } catch (e) { return fail(e); }
}

/** Accepts one training or { rows: [...] } for an Excel import. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const list: Record<string, unknown>[] = Array.isArray(b.rows) ? b.rows : [b];
    const ids: number[] = [];
    for (const raw of list as Record<string, any>[]) {
      if (!s(raw.name)) continue;
      const r: Record<string, any> = applyCategoryRules({ ...raw, category: raw.category || b.category });
      const start = d(r.start_date);
      const [row] = await q<{ id: number }>`
        INSERT INTO trainings (name, category, trainer, requested_by, mode, location, start_date, end_date,
                               start_time, end_time, skip_weekends, status_override, notes)
        VALUES (${s(r.name)}, ${r.category}, ${s(r.trainer)}, ${s(r.requested_by)}, ${s(r.mode)}, ${s(r.location)},
                ${start}, ${d(r.end_date) || start}, ${s(r.start_time)}, ${s(r.end_time)},
                ${r.skip_weekends === false ? false : true}, ${s(r.status_override)}, ${s(r.notes)})
        RETURNING id`;
      ids.push(row.id);
    }
    return ok({ ids, count: ids.length }, 201);
  } catch (e) { return fail(e); }
}
