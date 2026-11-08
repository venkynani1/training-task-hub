"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export type Task = {
  id: number; title: string; description: string; due_date: string | null; priority: string;
  status: string; source: string; email_subject: string; email_from: string; email_date: string;
  checklist: { text: string; done: boolean }[]; training_id: number | null; training_name?: string | null;
};
type TrainingOpt = { id: number; name: string };

export const TASK_STATUSES = ["To do", "In progress", "Waiting", "Done"];

export default function TaskForm({ task, trainings, onClose, onSaved }: {
  task?: Task | null; trainings: TrainingOpt[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: task?.title || "",
    description: task?.description || "",
    due_date: task?.due_date || "",
    priority: task?.priority || "Medium",
    status: task?.status || "To do",
    training_id: task?.training_id ? String(task.training_id) : "",
    steps: (task?.checklist || []).map((c) => c.text).join("\n"),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true); setErr("");
    const old = new Map((task?.checklist || []).map((c) => [c.text, c.done]));
    const checklist = f.steps.split("\n").map((t) => t.trim()).filter(Boolean)
      .map((text) => ({ text, done: old.get(text) ?? false }));
    const body = { ...f, checklist, training_id: f.training_id || null };
    try {
      if (task) await api(`/api/tasks/${task.id}`, "PATCH", body);
      else await api("/api/tasks", "POST", { ...body, source: "manual" });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!task || !confirm("Delete this task?")) return;
    await api(`/api/tasks/${task.id}`, "DELETE");
    onSaved();
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal stack">
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{task ? "Edit task" : "New task"}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <label>Title<input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label>Details<textarea rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
        <div className="grid3">
          <label>Due date<input type="date" value={f.due_date || ""} onChange={(e) => set("due_date", e.target.value)} /></label>
          <label>Priority
            <select value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              <option>High</option><option>Medium</option><option>Low</option>
            </select>
          </label>
          <label>Status
            <select value={f.status} onChange={(e) => set("status", e.target.value)}>
              {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label>Linked training
          <select value={f.training_id} onChange={(e) => set("training_id", e.target.value)}>
            <option value="">— none —</option>
            {trainings.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Steps (one per line)<textarea rows={4} value={f.steps} onChange={(e) => set("steps", e.target.value)} /></label>
        {task?.email_subject && (
          <p className="small muted" style={{ margin: 0 }}>From email: <b>{task.email_subject}</b> — {task.email_from}</p>
        )}
        {err && <p className="error">{err}</p>}
        <div className="row">
          {task && <button className="btn danger" onClick={remove}>Delete</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !f.title.trim()} onClick={save}>
            {busy ? <span className="spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
