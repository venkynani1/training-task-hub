"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export type EmailData = { subject: string; from: string; date: string; body: string; file?: string };
export type Extracted = {
  title: string; summary: string; priority: string; due_date: string; checklist: string[];
  is_training: boolean; questions: string[]; note?: string;
  training: Record<string, string>;
};

export default function EmailReview({ email, draft, onClose, onSaved }: {
  email: EmailData; draft: Extracted; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(draft.title || email.subject);
  const [summary, setSummary] = useState(draft.summary || "");
  const [priority, setPriority] = useState(draft.priority || "Medium");
  const [due, setDue] = useState(draft.due_date || "");
  const [steps, setSteps] = useState((draft.checklist || []).join("\n"));
  const [answers, setAnswers] = useState<string[]>((draft.questions || []).map(() => ""));
  const [extra, setExtra] = useState("");
  const [addTraining, setAddTraining] = useState(!!draft.is_training);
  const [tr, setTr] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = { ...(draft.training || {}) };
    t.category = /master/i.test(t.category || "") ? "Masterclass" : /ctadel/i.test(t.category || "") ? "Ctadel" : "Demand Based";
    if (t.category === "Masterclass") { t.start_time = "15:00"; t.end_time = "16:00"; }
    return t;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setT = (k: string, v: string) => setTr((p) => {
    const n = { ...p, [k]: v };
    if (n.category === "Masterclass") { n.start_time = "15:00"; n.end_time = "16:00"; }
    return n;
  });
  const isMC = tr.category === "Masterclass";

  async function save() {
    setBusy(true); setErr("");
    try {
      let training_id: number | null = null;
      if (addTraining && tr.name?.trim()) {
        const r = await api<{ ids: number[] }>("/api/trainings", "POST", { ...tr, notes: `From email: ${email.subject}` });
        training_id = r.ids[0] ?? null;
      }
      const qa = (draft.questions || [])
        .map((q, i) => (answers[i].trim() ? `• ${q}\n  → ${answers[i].trim()}` : ""))
        .filter(Boolean).join("\n");
      const description = [summary, qa && `Clarifications:\n${qa}`, extra.trim() && `Notes:\n${extra.trim()}`]
        .filter(Boolean).join("\n\n");
      await api("/api/tasks", "POST", {
        title, description, priority, due_date: due, source: "email",
        email_subject: email.subject, email_from: email.from, email_date: email.date, email_body: email.body,
        checklist: steps.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text, done: false })),
        training_id,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal stack">
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Task from email</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>
            <b>{email.subject || "(no subject)"}</b> — {email.from}
          </summary>
          <div className="emailbox" style={{ marginTop: 8 }}>{email.body}</div>
        </details>

        {draft.note && <div className="note">{draft.note}</div>}

        <label>Task title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Summary<textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
        <div className="grid2">
          <label>Due date<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label>Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>High</option><option>Medium</option><option>Low</option>
            </select>
          </label>
        </div>
        <label>Steps (one per line — becomes a checklist)
          <textarea rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>

        <div className="questions stack">
          <h3>Before saving — anything to fill in?</h3>
          {(draft.questions || []).map((q, i) => (
            <label key={i}>{q}
              <input value={answers[i]} placeholder="Your answer (optional)"
                onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
            </label>
          ))}
          <label>Anything else to add to this task?
            <textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)}
              placeholder="e.g. Share 3 trainer profiles with the requester by Wednesday" />
          </label>
        </div>

        <label className="check">
          <input type="checkbox" checked={addTraining} onChange={(e) => setAddTraining(e.target.checked)} />
          Also add this training to the tracker
        </label>
        {addTraining && (
          <div className="card stack" style={{ background: "var(--surface-2)", boxShadow: "none" }}>
            <div className="grid2">
              <label>Training name<input value={tr.name || ""} onChange={(e) => setT("name", e.target.value)} /></label>
              <label>Section
                <select value={tr.category} onChange={(e) => setT("category", e.target.value)}>
                  <option>Demand Based</option><option value="Masterclass">Masterclass (3–4 PM)</option><option>Ctadel</option>
                </select>
              </label>
            </div>
            <div className="grid3">
              <label>Trainer<input value={tr.trainer || ""} onChange={(e) => setT("trainer", e.target.value)} /></label>
              <label>Requested by<input value={tr.requested_by || ""} onChange={(e) => setT("requested_by", e.target.value)} /></label>
              <label>Mode
                <select value={tr.mode || ""} onChange={(e) => setT("mode", e.target.value)}>
                  <option value=""></option><option>Online</option><option>In-person</option><option>Hybrid</option>
                </select>
              </label>
              <label>Start date<input type="date" value={tr.start_date || ""} onChange={(e) => setT("start_date", e.target.value)} /></label>
              <label>End date<input type="date" value={tr.end_date || ""} onChange={(e) => setT("end_date", e.target.value)} /></label>
              <label>Location / link<input value={tr.location || ""} onChange={(e) => setT("location", e.target.value)} /></label>
              <label>Start time<input type="time" value={tr.start_time || ""} disabled={isMC} onChange={(e) => setT("start_time", e.target.value)} /></label>
              <label>End time<input type="time" value={tr.end_time || ""} disabled={isMC} onChange={(e) => setT("end_time", e.target.value)} /></label>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Leave dates empty if not fixed yet — you can fill them in the tracker later.</p>
          </div>
        )}

        {err && <p className="error">{err}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !title.trim()} onClick={save}>
            {busy ? <span className="spin" /> : "Save task"}
          </button>
        </div>
      </div>
    </div>
  );
}
