import { askJSON, aiConfigured, shortErr } from "@/lib/ai";
import { ok, fail, s } from "@/lib/http";
import { todayIST } from "@/lib/status";

export const maxDuration = 60;

const SYSTEM = `You turn work emails into tasks for a corporate training coordinator.
Their workflow: receive training requests from teams, gather and share trainer profiles,
schedule trainer evaluation calls, finalize trainers, raise PRs (purchase requests),
run trainings, collect feedback, and upload daily attendance to the LMS.

Reply with ONE JSON object and nothing else, shaped exactly like:
{
  "title": "short imperative task title",
  "summary": "2-4 sentences: what is being asked, by whom, and any constraints",
  "priority": "High" | "Medium" | "Low",
  "due_date": "YYYY-MM-DD" or "",
  "checklist": ["concrete next steps for the coordinator, in order"],
  "is_training": true/false,
  "training": {
    "name": "", "category": "Demand Based" | "Masterclass" | "Ctadel", "trainer": "", "requested_by": "", "mode": "Online|In-person|Hybrid|",
    "location": "", "start_date": "YYYY-MM-DD or empty", "end_date": "YYYY-MM-DD or empty",
    "start_time": "HH:MM or empty", "end_time": "HH:MM or empty"
  },
  "questions": ["questions about details the email leaves out that the coordinator should confirm"]
}
Rules: resolve relative dates ("next Monday") against today's date. Never invent names, dates or numbers
the email doesn't support — leave them empty and ask about them in "questions" instead.
Keep 2-5 questions, most important first.
Training sections: "Masterclass" if the email is about a masterclass (masterclasses always run 15:00–16:00, so use those
times and don't ask about timing); "Ctadel" if it mentions Ctadel; otherwise "Demand Based" (a team's training request). Set is_training true only if the email is about a training program.`;

function ruleBased(subject: string, from: string, body: string) {
  const text = `${subject}\n${body}`;
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const dmy = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  const date = iso ? iso[0] : dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "";
  const isTraining = /training|session|workshop|bootcamp|course/i.test(text);
  return {
    title: subject.replace(/^(re|fw|fwd):\s*/gi, "") || "Follow up on email",
    summary: body.replace(/\s+/g, " ").slice(0, 400),
    priority: /urgent|asap|immediately/i.test(text) ? "High" : "Medium",
    due_date: date,
    checklist: [],
    is_training: isTraining,
    training: { name: isTraining ? subject : "", category: /master\s*class/i.test(text) ? "Masterclass" : /ctadel/i.test(text) ? "Ctadel" : "Demand Based", trainer: "", requested_by: from, mode: "", location: "",
      start_date: date, end_date: "", start_time: "", end_time: "" },
    questions: ["What's the deadline for this?", "Anything else to add to this task?"],
    note: "Read without AI (no GROQ_API_KEY set), so check the details." as string | undefined,
  };
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const subject = s(b.subject), from = s(b.from), date = s(b.date);
    const body = s(b.body).slice(0, 15000);
    if (!subject && !body) return fail("The email looks empty", 400);

    const prompt = `Today is ${todayIST()} (India).\n\nFrom: ${from}\nSent: ${date}\nSubject: ${subject}\n\n${body}`;
    const basic = ruleBased(subject, from, body);

    if (!aiConfigured()) return ok(basic);
    try {
      const parsed = await askJSON(SYSTEM, prompt);
      return ok({
        ...basic,
        ...parsed,
        checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : basic.questions,
        training: { ...basic.training, ...(parsed.training || {}) },
        note: undefined,
      });
    } catch (e) {
      console.error("AI extraction failed:", e);
      return ok({ ...basic, note: `AI reading failed (${shortErr(e)}), so these are basic details — check them.` });
    }
  } catch (e) { return fail(e); }
}
