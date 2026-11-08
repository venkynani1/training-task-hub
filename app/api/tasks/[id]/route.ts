import { q } from "@/lib/db";
import { ok, fail, s, d } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const [row] = await q`SELECT *, due_date::text AS due_date FROM tasks WHERE id = ${Number(id)}`;
    return row ? ok(row) : fail("Not found", 404);
  } catch (e) { return fail(e); }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const [cur] = await q<Record<string, unknown>>`SELECT *, due_date::text AS due_date FROM tasks WHERE id = ${Number(id)}`;
    if (!cur) return fail("Not found", 404);
    const m = { ...cur, ...(await req.json()) };
    await q`UPDATE tasks SET
      title = ${s(m.title)}, description = ${s(m.description)}, due_date = ${d(m.due_date)},
      priority = ${s(m.priority)}, status = ${s(m.status)},
      checklist = ${JSON.stringify(Array.isArray(m.checklist) ? m.checklist : [])}::jsonb,
      training_id = ${m.training_id ? Number(m.training_id) : null}
      WHERE id = ${Number(id)}`;
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(_: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await q`DELETE FROM tasks WHERE id = ${Number(id)}`;
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
