"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, fmtDate, todayIST, statusClass } from "@/lib/client";
import EmailReview, { type EmailData, type Extracted } from "@/components/EmailReview";
import TaskForm, { type Task, TASK_STATUSES } from "@/components/TaskForm";

async function parseEmailFile(file: File): Promise<EmailData> {
  if (/\.msg$/i.test(file.name)) {
    const MsgReader = (await import("@kenjiuno/msgreader")).default;
    const f = new MsgReader(await file.arrayBuffer()).getFileData() as any;
    if (f.error) throw new Error("Couldn't read that .msg file");
    const addr = f.senderSmtpAddress || f.senderEmail || "";
    return {
      subject: f.subject || "",
      from: [f.senderName, addr && `<${addr}>`].filter(Boolean).join(" "),
      date: f.messageDeliveryTime || f.clientSubmitTime || "",
      body: (f.body || "").trim(),
      file: file.name,
    };
  }
  // .eml / .txt — read headers + plain body
  const raw = await file.text();
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const h = (k: string) => head.match(new RegExp(`^${k}:\\s*(.*)$`, "im"))?.[1]?.trim() || "";
  const isEml = /^(from|subject):/im.test(head);
  return isEml
    ? { subject: h("Subject"), from: h("From"), date: h("Date"), body: rest.join("\n\n").replace(/<[^>]+>/g, " ").trim(), file: file.name }
    : { subject: "", from: "", date: "", body: raw.trim(), file: file.name };
}

function splitPasted(text: string): EmailData {
  const get = (k: string) => text.match(new RegExp(`^${k}:\\s*(.*)$`, "im"))?.[1]?.trim() || "";
  return { subject: get("Subject"), from: get("From"), date: get("Sent") || get("Date"), body: text.trim() };
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trainings, setTrainings] = useState<{ id: number; name: string; status: string; attendance_due: boolean }[]>([]);
  const [tab, setTab] = useState("Open");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [review, setReview] = useState<{ email: EmailData; draft: Extracted } | null>(null);
  const [editing, setEditing] = useState<Task | null | undefined>(undefined);
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [t, tr] = await Promise.all([api<Task[]>("/api/tasks"), api<any[]>("/api/trainings")]);
      setTasks(t); setTrainings(tr); setLoadErr("");
    } catch (e) { setLoadErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  async function extract(email: EmailData) {
    setReading(email.subject || email.file || "email");
    try {
      const draft = await api<Extracted>("/api/extract", "POST", email);
      setReview({ email, draft });
    } catch (e) { alert("Couldn't read the email: " + (e as Error).message); }
    finally { setReading(""); }
  }

  async function handleFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      try { await extract(await parseEmailFile(f)); return; }
      catch (e) { alert((e as Error).message); }
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault(); setOver(false);
    if (e.dataTransfer.files.length) return handleFiles(e.dataTransfer.files);
    const text = e.dataTransfer.getData("text/plain");
    if (text.trim()) extract(splitPasted(text));
  }

  async function patch(t: Task, change: Partial<Task>) {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, ...change } : x)));
    try { await api(`/api/tasks/${t.id}`, "PATCH", change); } catch (e) { alert((e as Error).message); load(); }
  }

  const today = todayIST();
  const open = tasks.filter((t) => t.status !== "Done");
  const counts = {
    open: open.length,
    overdue: open.filter((t) => t.due_date && t.due_date < today).length,
    dueToday: open.filter((t) => t.due_date === today).length,
    ongoing: trainings.filter((t) => t.status === "Ongoing").length,
  };
  const attendanceDue = trainings.filter((t) => t.attendance_due);

  const shown = tasks.filter((t) => {
    if (tab === "Open" && t.status === "Done") return false;
    if (tab !== "Open" && tab !== "All" && t.status !== tab) return false;
    if (query && !`${t.title} ${t.description} ${t.email_subject} ${t.training_name || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Tasks</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{fmtDate(today)}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing(null)}>+ Add task</button>
      </div>

      {loadErr && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <b className="error">Can't reach the database.</b>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{loadErr}</p>
        </div>
      )}

      <div className="stats">
        <div className="stat"><b>{counts.open}</b><span>Open tasks</span></div>
        <div className="stat"><b style={{ color: counts.overdue ? "var(--bad)" : undefined }}>{counts.overdue}</b><span>Overdue</span></div>
        <div className="stat"><b>{counts.dueToday}</b><span>Due today</span></div>
        <div className="stat"><b>{counts.ongoing}</b><span>Trainings running</span></div>
      </div>

      {attendanceDue.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid var(--warn)" }}>
          <h3>Mark today's attendance</h3>
          <div className="row">
            {attendanceDue.map((t) => (
              <Link key={t.id} href={`/trainings/${t.id}`} className="btn sm">{t.name} →</Link>
            ))}
          </div>
        </div>
      )}

      <div className={over ? "drop over" : "drop"}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}>
        {reading ? (
          <span><span className="spin" /> Reading “{reading}”…</span>
        ) : (
          <>
            <strong>Drop an Outlook email here</strong>
            <span className="muted small">Drag a mail from Outlook (or a saved .msg / .eml file). It becomes a task you can review first.</span>
            <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
              <button className="btn sm" onClick={() => fileRef.current?.click()}>Choose file</button>
              <button className="btn sm" onClick={() => setPasteOpen((v) => !v)}>Paste email text</button>
            </div>
            <input ref={fileRef} type="file" accept=".msg,.eml,.txt" hidden
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      {pasteOpen && !reading && (
        <div className="card stack" style={{ marginTop: 10 }}>
          <label>Paste the whole email (From / Subject lines help)
            <textarea rows={7} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!pasted.trim()}
              onClick={() => { extract(splitPasted(pasted)); setPasted(""); setPasteOpen(false); }}>
              Make task
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <div className="tabs" style={{ flex: 1, marginBottom: 0 }}>
          {["Open", ...TASK_STATUSES, "All"].map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <input style={{ maxWidth: 220 }} placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0, marginTop: 10 }}>
        {loading ? <div className="empty"><span className="spin" /></div>
          : shown.length === 0 ? <div className="empty">No tasks here. Drop an email or add one.</div>
          : shown.map((t) => {
            const late = t.status !== "Done" && t.due_date && t.due_date < today;
            const doneSteps = t.checklist?.filter((c) => c.done).length || 0;
            return (
              <div key={t.id} className={t.status === "Done" ? "task done" : "task"}>
                <input type="checkbox" checked={t.status === "Done"} style={{ marginTop: 3 }}
                  onChange={(e) => patch(t, { status: e.target.checked ? "Done" : "To do" })} />
                <div style={{ minWidth: 0 }}>
                  <div className="task-title" onClick={() => setEditing(t)}>{t.title}</div>
                  <div className="task-meta">
                    <span className={statusClass(t.priority)}>{t.priority}</span>
                    {t.due_date && <span className={late ? "overdue" : ""}>Due {fmtDate(t.due_date)}{late ? " · overdue" : ""}</span>}
                    {t.source === "email" && <span className="pill pill-email" title={t.email_subject}>✉ Email</span>}
                    {t.training_id && <Link href={`/trainings/${t.training_id}`}>{t.training_name}</Link>}
                    {t.checklist?.length > 0 && <span>{doneSteps}/{t.checklist.length} steps</span>}
                  </div>
                  {t.checklist?.length > 0 && t.status !== "Done" && (
                    <ul className="checklist">
                      {t.checklist.map((c, i) => (
                        <li key={i} className={c.done ? "done" : ""}>
                          <input type="checkbox" checked={c.done}
                            onChange={() => patch(t, { checklist: t.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <select className="statusbox" value={t.status} onChange={(e) => patch(t, { status: e.target.value })}>
                  {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            );
          })}
      </div>

      {review && (
        <EmailReview email={review.email} draft={review.draft} onClose={() => setReview(null)}
          onSaved={() => { setReview(null); flash("Task saved"); load(); }} />
      )}
      {editing !== undefined && (
        <TaskForm task={editing} trainings={trainings} onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); flash("Saved"); load(); }} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
