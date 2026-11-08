import { q } from "@/lib/db";
import { ok, fail, s, d } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await q`
      SELECT t.id, t.title, t.description, t.due_date::text AS due_date, t.priority, t.status, t.source,
             t.email_subject, t.email_from, t.email_date, t.checklist, t.training_id, t.created_at,
             tr.name AS training_name
      FROM tasks t LEFT JOIN trainings tr ON tr.id = t.training_id
      ORDER BY (t.status = 'Done'), t.due_date NULLS LAST, t.id DESC`;
    return ok(rows);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!s(b.title)) return fail("Title is required", 400);
    const [row] = await q`
      INSERT INTO tasks (title, description, due_date, priority, status, source,
                         email_subject, email_from, email_date, email_body, checklist, training_id)
      VALUES (${s(b.title)}, ${s(b.description)}, ${d(b.due_date)}, ${s(b.priority) || "Medium"},
              ${s(b.status) || "To do"}, ${s(b.source) || "manual"}, ${s(b.email_subject)},
              ${s(b.email_from)}, ${s(b.email_date)}, ${s(b.email_body).slice(0, 20000)},
              ${JSON.stringify(Array.isArray(b.checklist) ? b.checklist : [])}::jsonb,
              ${b.training_id ? Number(b.training_id) : null})
      RETURNING id`;
    return ok(row, 201);
  } catch (e) { return fail(e); }
}
