import Anthropic from "@anthropic-ai/sdk";
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
    "name": "", "trainer": "", "requested_by": "", "mode": "Online|In-person|Hybrid|",
    "location": "", "start_date": "YYYY-MM-DD or empty", "end_date": "YYYY-MM-DD or empty",
    "start_time": "HH:MM or empty", "end_time": "HH:MM or empty"
  },
  "questions": ["questions about details the email leaves out that the coordinator should confirm"]
}
Rules: resolve relative dates ("next Monday") against today's date. Never invent names, dates or numbers
the email doesn't support — leave them empty and ask about them in "questions" instead.
Keep 2-5 questions, most important first. Set is_training true only if the email is about a training program.`;

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
    training: { name: isTraining ? subject : "", trainer: "", requested_by: from, mode: "", location: "",
      start_date: date, end_date: "", start_time: "", end_time: "" },
    questions: ["What's the deadline for this?", "Anything else to add to this task?"],
    note: "Read without AI (ANTHROPIC_API_KEY is not set), so check the details.",
  };
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const subject = s(b.subject), from = s(b.from), date = s(b.date);
    const body = s(b.body).slice(0, 15000);
    if (!subject && !body) return fail("The email looks empty", 400);

    if (!process.env.ANTHROPIC_API_KEY) return ok(ruleBased(subject, from, body));

    const client = new Anthropic();
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Today is ${todayIST()} (India).\n\nFrom: ${from}\nSent: ${date}\nSubject: ${subject}\n\n${body}`,
      }],
    });
    const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try {
      return ok(JSON.parse(json));
    } catch {
      return ok({ ...ruleBased(subject, from, body), note: "Couldn't read the AI reply, so these are basic details." });
    }
  } catch (e) { return fail(e); }
}
