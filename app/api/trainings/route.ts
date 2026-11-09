import { q, removeDuplicateTrainings } from "@/lib/db";
import { ok, fail, s, d } from "@/lib/http";
import { trainingStatus, trainingDays, todayIST, applyCategoryRules, trainingKey } from "@/lib/status";

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

/**
 * Accepts one training or { rows: [...] } for an Excel import.
 * A row with the same name + section + start date as an existing training is a duplicate:
 * it updates that training (non-empty cells only) instead of adding a second copy.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const list: Record<string, any>[] = Array.isArray(b.rows) ? b.rows : [b];
    const ids: number[] = [];
    let added = 0, updated = 0, skipped = 0;
    const seen = new Set<string>();
    const dedupe = Array.isArray(b.rows); // sheet imports; a single typed row is always added

    const existing = await q<{ id: number; name: string; category: string; start_date: string | null }>`
      SELECT id, name, COALESCE(category, 'Demand Based') AS category, start_date::text AS start_date
      FROM trainings ORDER BY id`;
    const byKey = new Map<string, number>();
    for (const e of existing) {
      const k = trainingKey(e.name, e.category, e.start_date);
      if (!byKey.has(k)) byKey.set(k, e.id);
    }

    for (const raw of list) {
      if (!s(raw.name)) continue;
      const r: Record<string, any> = applyCategoryRules({ ...raw, category: raw.category || b.category });
      const start = d(r.start_date);
      const key = trainingKey(r.name, r.category, start);
      if (dedupe && seen.has(key)) { skipped++; continue; } // same row twice in one sheet
      seen.add(key);

      const matchId = dedupe ? byKey.get(key) : undefined;
      if (matchId) {
        // fill in / refresh details from the sheet, keep anything the sheet leaves blank
        const v = (x: unknown) => s(x) || null;
        await q`UPDATE trainings SET
          trainer = COALESCE(${v(r.trainer)}, trainer),
          requested_by = COALESCE(${v(r.requested_by)}, requested_by),
          mode = COALESCE(${v(r.mode)}, mode),
          location = COALESCE(${v(r.location)}, location),
          end_date = COALESCE(${d(r.end_date)}::date, end_date),
          start_time = COALESCE(${v(r.start_time)}, start_time),
          end_time = COALESCE(${v(r.end_time)}, end_time),
          notes = COALESCE(${v(r.notes)}, notes)
          WHERE id = ${matchId}`;
        ids.push(matchId); updated++;
        continue;
      }

      const [row] = await q<{ id: number }>`
        INSERT INTO trainings (name, category, trainer, requested_by, mode, location, start_date, end_date,
                               start_time, end_time, skip_weekends, status_override, notes)
        VALUES (${s(r.name).replace(/\s+/g, " ")}, ${r.category}, ${s(r.trainer)}, ${s(r.requested_by)}, ${s(r.mode)}, ${s(r.location)},
                ${start}, ${d(r.end_date) || start}, ${s(r.start_time)}, ${s(r.end_time)},
                ${r.skip_weekends === false ? false : true}, ${s(r.status_override)}, ${s(r.notes)})
        RETURNING id`;
      byKey.set(key, row.id);
      ids.push(row.id); added++;
    }
    if (dedupe) await removeDuplicateTrainings();
    return ok({ ids, count: added, added, updated, skipped }, 201);
  } catch (e) { return fail(e); }
}
