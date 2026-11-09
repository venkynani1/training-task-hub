import { q } from "@/lib/db";
import { ok, fail, s, d } from "@/lib/http";
import { trainingStatus, trainingDays, applyCategoryRules } from "@/lib/status";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const [t] = await q<Record<string, any>>`
      SELECT *, start_date::text AS start_date, end_date::text AS end_date FROM trainings WHERE id = ${id}`;
    if (!t) return fail("Not found", 404);
    const participants = await q`SELECT id, emp_id, name, email FROM participants WHERE training_id = ${id} ORDER BY name`;
    const attendance = await q`SELECT participant_id, day::text AS day, present FROM attendance WHERE training_id = ${id}`;
    return ok({
      ...t,
      category: t.category || "Demand Based",
      status: trainingStatus(t),
      days: trainingDays(t.start_date || "", t.end_date || "", t.skip_weekends),
      participants,
      attendance,
    });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const [cur] = await q<Record<string, unknown>>`
      SELECT *, start_date::text AS start_date, end_date::text AS end_date FROM trainings WHERE id = ${id}`;
    if (!cur) return fail("Not found", 404);
    const m = applyCategoryRules({ ...cur, ...(await req.json()) });
    if (!s(m.name)) return fail("Training name can't be empty", 400);
    await q`UPDATE trainings SET
      name = ${s(m.name)}, category = ${m.category}, trainer = ${s(m.trainer)}, requested_by = ${s(m.requested_by)},
      mode = ${s(m.mode)}, location = ${s(m.location)},
      start_date = ${d(m.start_date)}, end_date = ${d(m.end_date)},
      start_time = ${s(m.start_time)}, end_time = ${s(m.end_time)},
      skip_weekends = ${m.skip_weekends === false ? false : true},
      status_override = ${s(m.status_override)}, notes = ${s(m.notes)}
      WHERE id = ${id}`;
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    await q`DELETE FROM trainings WHERE id = ${Number((await params).id)}`;
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
