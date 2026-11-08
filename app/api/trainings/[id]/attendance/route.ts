import { q } from "@/lib/db";
import { ok, fail, d } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Body: { day, marks: [{ participant_id, present }] }   — set marks for a day
 *    or { day, clear: true }                              — clear a day
 */
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const id = Number((await params).id);
    const b = await req.json();
    const day = d(b.day);
    if (!day) return fail("day is required (YYYY-MM-DD)", 400);
    if (b.clear) {
      await q`DELETE FROM attendance WHERE training_id = ${id} AND day = ${day}`;
      return ok({ ok: true });
    }
    for (const m of b.marks || []) {
      if (m.present === null) {
        await q`DELETE FROM attendance WHERE participant_id = ${Number(m.participant_id)} AND day = ${day}`;
      } else {
        await q`INSERT INTO attendance (training_id, participant_id, day, present)
                VALUES (${id}, ${Number(m.participant_id)}, ${day}, ${!!m.present})
                ON CONFLICT (participant_id, day) DO UPDATE SET present = EXCLUDED.present`;
      }
    }
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}
