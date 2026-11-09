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

    let text = "";
    try {
      if (process.env.GROQ_API_KEY) text = await askGroq(prompt);
      else if (process.env.ANTHROPIC_API_KEY) text = await askClaude(prompt);
      else return ok(basic);
    } catch (e) {
      console.error("AI extraction failed:", e);
      return ok({ ...basic, note: `AI reading failed (${short(e)}), so these are basic details — check them.` });
    }

    try {
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      return ok({
        ...basic,
        ...parsed,
        checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : basic.questions,
        training: { ...basic.training, ...(parsed.training || {}) },
        note: undefined,
      });
    } catch {
      return ok({ ...basic, note: "Couldn't read the AI reply, so these are basic details." });
    }
  } catch (e) { return fail(e); }
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

const GROQ = "https://api.groq.com/openai/v1";
const PREFERRED = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
let workingModel: string | null = null; // remembered while the server instance is warm

async function groqChat(model: string, prompt: string, json: boolean) {
  const res = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, msg: String(data?.error?.message || ""), text: data.choices?.[0]?.message?.content || "" };
}

/** Models this key can use, best first. */
async function availableModels(): Promise<string[]> {
  try {
    const res = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
    const data = await res.json();
    const ids: string[] = (data.data || [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => !/whisper|tts|guard|playai|orpheus|distil|compound/i.test(id));
    const rank = (id: string) => { const i = PREFERRED.indexOf(id); return i < 0 ? 99 : i; };
    return ids.sort((a, b) => rank(a) - rank(b));
  } catch { return []; }
}

async function askGroq(prompt: string): Promise<string> {
  const tried = new Set<string>();
  const candidates = [workingModel, process.env.GROQ_MODEL, ...PREFERRED].filter(Boolean) as string[];
  let lastErr = "";
  for (let round = 0; round < 2; round++) {
    for (const model of candidates) {
      if (tried.has(model)) continue;
      tried.add(model);
      let r = await groqChat(model, prompt, true);
      // some models reject JSON mode — retry plain
      if (!r.ok && r.status === 400 && /response_format|json/i.test(r.msg)) r = await groqChat(model, prompt, false);
      if (r.ok && r.text) { workingModel = model; return r.text; }
      lastErr = r.msg || `Groq error ${r.status}`;
      // bad key or rate limit won't be fixed by switching models
      if (r.status === 401 || r.status === 429) throw new Error(lastErr);
    }
    if (round === 0) candidates.push(...(await availableModels()));
  }
  throw new Error(lastErr || "No Groq model available for this key");
}

async function askClaude(prompt: string): Promise<string> {
  const msg = await new Anthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}
