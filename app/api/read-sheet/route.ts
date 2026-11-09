import { ok, fail, s } from "@/lib/http";
import { askJSON, aiConfigured, shortErr } from "@/lib/ai";
import { todayIST } from "@/lib/status";

export const maxDuration = 60;

const TRAININGS = (section: string) => `You read rows from a corporate training schedule spreadsheet and turn each training into structured data.
Rows arrive as "R<number>: cell | cell | ...". Rows marked as context are only there so you can see the title and header row — never extract from them.

Reply with ONE JSON object, nothing else:
{"trainings":[{"row":12,"name":"","category":"Demand Based|Masterclass|Ctadel","trainer":"","requested_by":"",
"mode":"Online|In-person|Hybrid|","location":"","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM",
"status_override":"On Hold|Cancelled|","notes":""}]}

Rules:
- One entry per real training row. Skip blank rows, titles, headers, section headings, totals.
- Work out what each column means from the header row even if it's named oddly (e.g. "Faculty", "SME" = trainer; "BU", "Account", "SPOC", "Requested by" = requested_by; "Venue", "Teams link" = location).
- Dates are day-first (India): 05/11/2026 is 5 Nov 2026. A cell like "17–28 Nov" or "17 Nov to 28 Nov" is a start and end date. If the year is missing, use the year that makes sense around today.
- Times in 24h HH:MM. "10 AM – 1 PM" → start 10:00, end 13:00. Leave empty if not given.
- category: "Masterclass" if the row/section/type says masterclass (masterclasses always run 15:00–16:00); "Ctadel" if it says Ctadel; otherwise "${section}".
- status_override only for rows clearly marked on hold / postponed (On Hold) or cancelled/dropped (Cancelled); otherwise "".
- Put other useful columns (batch size, PR number, cost, duration, remarks) into notes as "Label: value; Label: value".
- Never invent values. Leave a field "" when the sheet doesn't have it.`;

const PEOPLE = `You read rows from a spreadsheet listing training participants.
Rows arrive as "R<number>: cell | cell | ...". Rows marked as context are only there to show the header — never extract from them.
Reply with ONE JSON object, nothing else: {"participants":[{"row":5,"emp_id":"","name":"","email":""}]}
Skip blank, title, header and total rows. The name is the person's full name; emp_id is their employee number/code;
email is their email address. Never invent values — use "" when missing.`;

/**
 * Body: { kind: "trainings" | "participants", rows: string[][], start: number, context: string[][], section }
 * rows is one chunk of the sheet; start is the sheet row number of rows[0]; context is the first few sheet rows.
 */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (!aiConfigured()) return ok({ ai: false, items: [] });
    const kind = b.kind === "participants" ? "participants" : "trainings";
    const start = Number(b.start) || 1;
    const fmt = (r: unknown[]) => (r || []).map((c) => s(c).replace(/\s+/g, " ").slice(0, 200)).join(" | ");
    const ctx = (b.context || []) as unknown[][];
    const rows = (b.rows || []) as unknown[][];
    const lines = rows
      .map((r, i) => ({ n: start + i, text: fmt(r) }))
      .filter((r) => r.text.replace(/[|\s]/g, ""));
    if (!lines.length) return ok({ ai: true, items: [] });

    const prompt = [
      `Today is ${todayIST()} (India).${b.fileName ? ` File: ${s(b.fileName)}` : ""}`,
      ctx.length ? `Context rows (top of the sheet — do not extract):\n${ctx.map((r, i) => `R${i + 1}: ${fmt(r)}`).join("\n")}` : "",
      `Rows to read:\n${lines.map((l) => `R${l.n}: ${l.text}`).join("\n")}`,
    ].filter(Boolean).join("\n\n");

    try {
      const out = await askJSON(kind === "participants" ? PEOPLE : TRAININGS(s(b.section) || "Demand Based"), prompt, 4000);
      const items = Array.isArray(out?.[kind]) ? out[kind] : [];
      const firstData = Math.max(start, ctx.length + 1);
      // drop anything the model pulled from the context rows
      return ok({ ai: true, items: items.filter((x: any) => !x?.row || Number(x.row) >= firstData || start === 1) });
    } catch (e) {
      console.error("AI sheet reading failed:", e);
      return ok({ ai: false, error: shortErr(e), items: [] });
    }
  } catch (e) { return fail(e); }
}
