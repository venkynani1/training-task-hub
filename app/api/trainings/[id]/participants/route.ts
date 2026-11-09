import { q } from "@/lib/db";
import { ok, fail, s } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** Body: { rows: [{ emp_id, name, email }] } */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const b = await req.json();
    const rows: Record<string, unknown>[] = Array.isArray(b.rows) ? b.rows : [b];
    let count = 0, skipped = 0;
    const existing = await q<{ emp_id: string; name: string; email: string }>`
      SELECT emp_id, name, email FROM participants WHERE training_id = ${id}`;
    const seen = new Set<string>();
    const keysOf = (r: { emp_id?: unknown; name?: unknown; email?: unknown }) => [
      s(r.emp_id) && "id:" + s(r.emp_id).toLowerCase(),
      s(r.email) && "em:" + s(r.email).toLowerCase(),
      !s(r.emp_id) && !s(r.email) && "nm:" + s(r.name).toLowerCase().replace(/\s+/g, " "),
    ].filter(Boolean) as string[];
    existing.forEach((e) => keysOf(e).forEach((k) => seen.add(k)));
    for (const r of rows) {
      if (!s(r.name)) continue;
      const keys = keysOf(r);
      if (keys.some((k) => seen.has(k))) { skipped++; continue; }
      keys.forEach((k) => seen.add(k));
      await q`INSERT INTO participants (training_id, emp_id, name, email)
              VALUES (${id}, ${s(r.emp_id)}, ${s(r.name)}, ${s(r.email)})`;
      count++;
    }
    return ok({ count, skipped }, 201);
  } catch (e) { return fail(e); }
}

/** ?pid=123 removes one participant; no pid clears the list. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const pid = new URL(req.url).searchParams.get("pid");
    if (pid) await q`DELETE FROM participants WHERE id = ${Number(pid)} AND training_id = ${id}`;
    else await q`DELETE FROM participants WHERE training_id = ${id}`;
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
