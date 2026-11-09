import Anthropic from "@anthropic-ai/sdk";

const GROQ = "https://api.groq.com/openai/v1";
const PREFERRED = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];
let workingModel: string | null = null; // remembered while the server instance is warm

export const aiConfigured = () => !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY);
export const shortErr = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 140);

/** Sends a system + user prompt to Groq (or Claude if only that key is set) and returns the parsed JSON object. */
export async function askJSON<T = any>(system: string, prompt: string, maxTokens = 2000): Promise<T> {
  const text = process.env.GROQ_API_KEY
    ? await askGroq(system, prompt, maxTokens)
    : await askClaude(system, prompt, maxTokens);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(json) as T; }
  catch { throw new Error("The AI reply wasn't valid JSON"); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function groqChat(model: string, system: string, prompt: string, json: boolean, maxTokens: number) {
  const res = await fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok, status: res.status, msg: String(data?.error?.message || ""),
    retryAfter: Number(res.headers.get("retry-after")) || 0,
    text: data.choices?.[0]?.message?.content || "",
  };
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

async function askGroq(system: string, prompt: string, maxTokens: number): Promise<string> {
  const tried = new Set<string>();
  const candidates = [workingModel, process.env.GROQ_MODEL, ...PREFERRED].filter(Boolean) as string[];
  let lastErr = "";
  for (let round = 0; round < 2; round++) {
    for (const model of candidates) {
      if (tried.has(model)) continue;
      tried.add(model);
      let r = await groqChat(model, system, prompt, true, maxTokens);
      // free-tier rate limit: wait briefly once
      if (r.status === 429 && r.retryAfter && r.retryAfter <= 20) {
        await sleep(r.retryAfter * 1000);
        r = await groqChat(model, system, prompt, true, maxTokens);
      }
      // some models reject JSON mode — retry plain
      if (!r.ok && r.status === 400 && /response_format|json/i.test(r.msg)) r = await groqChat(model, system, prompt, false, maxTokens);
      if (r.ok && r.text) { workingModel = model; return r.text; }
      lastErr = r.msg || `Groq error ${r.status}`;
      // bad key or rate limit won't be fixed by switching models
      if (r.status === 401 || r.status === 429) throw new Error(lastErr);
    }
    if (round === 0) candidates.push(...(await availableModels()));
  }
  throw new Error(lastErr || "No Groq model available for this key");
}

async function askClaude(system: string, prompt: string, maxTokens: number): Promise<string> {
  const msg = await new Anthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}
