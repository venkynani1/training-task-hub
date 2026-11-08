"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  api, mapRows, readSpreadsheet, PARTICIPANT_COLUMNS, downloadCSV, fmtDate, todayIST, statusClass,
} from "@/lib/client";

type P = { id: number; emp_id: string; name: string; email: string };
type T = {
  id: number; name: string; trainer: string; requested_by: string; mode: string; location: string;
  start_date: string | null; end_date: string | null; start_time: string; end_time: string;
  skip_weekends: boolean; status_override: string; notes: string; status: string;
  days: string[]; participants: P[]; attendance: { participant_id: number; day: string; present: boolean }[];
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayLabel = (d: string) => {
  const dt = new Date(d + "T00:00:00Z");
  return { top: WD[dt.getUTCDay()], bottom: fmtDate(d).slice(0, 6) };
};

export default function TrainingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t, setT] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [marks, setMarks] = useState<Map<string, boolean>>(new Map());
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [pasteList, setPasteList] = useState("");
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const todayRef = useRef<HTMLTableCellElement>(null);
  const today = todayIST();

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const load = useCallback(async () => {
    try {
      const data = await api<T>(`/api/trainings/${id}`);
      setT(data);
      setMarks(new Map(data.attendance.map((a) => [`${a.participant_id}|${a.day}`, a.present])));
      setForm({ ...data });
    } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { todayRef.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, [t?.days.length]);

  async function setMark(pids: number[], day: string, present: boolean | null) {
    setMarks((m) => {
      const n = new Map(m);
      pids.forEach((p) => (present === null ? n.delete(`${p}|${day}`) : n.set(`${p}|${day}`, present)));
      return n;
    });
    try {
      await api(`/api/trainings/${id}/attendance`, "PUT", {
        day, marks: pids.map((participant_id) => ({ participant_id, present })),
      });
    } catch (e) { alert((e as Error).message); load(); }
  }

  const cycle = (pid: number, day: string) => {
    const cur = marks.get(`${pid}|${day}`);
    setMark([pid], day, cur === undefined ? true : cur ? false : null);
  };

  async function saveDetails() {
    try {
      await api(`/api/trainings/${id}`, "PATCH", form);
      setEdit(false); flash("Details saved"); load();
    } catch (e) { alert((e as Error).message); }
  }

  async function addPeople(rows: Record<string, unknown>[]) {
    const clean = rows.map((r) => ({
      emp_id: String(r.emp_id ?? "").trim(), name: String(r.name ?? "").trim(), email: String(r.email ?? "").trim(),
    })).filter((r) => r.name);
    if (!clean.length) { alert("No names found. The sheet needs a Name column (Emp ID and Email are optional)."); return; }
    const existing = new Set(t?.participants.map((p) => (p.emp_id || p.name).toLowerCase()));
    const fresh = clean.filter((r) => !existing.has((r.emp_id || r.name).toLowerCase()));
    if (!fresh.length) { flash("Everyone's already on the list"); return; }
    await api(`/api/trainings/${id}/participants`, "POST", { rows: fresh });
    flash(`Added ${fresh.length} participant${fresh.length > 1 ? "s" : ""}`);
    setAddOpen(false); setPasteList(""); load();
  }

  async function fromFile(file: File) {
    try { addPeople(mapRows(await readSpreadsheet(file), PARTICIPANT_COLUMNS)); }
    catch (e) { alert("Couldn't read that file: " + (e as Error).message); }
  }

  function fromPaste() {
    const rows = pasteList.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/\t|,/).map((x) => x.trim());
      const email = parts.find((p) => p.includes("@")) || "";
      const emp = parts.find((p) => /^[A-Za-z]{0,3}\d{3,}$/.test(p)) || "";
      const name = parts.find((p) => p && p !== email && p !== emp) || "";
      return { name, emp_id: emp, email };
    });
    addPeople(rows);
  }

  async function removePerson(p: P) {
    if (!confirm(`Remove ${p.name}?`)) return;
    await api(`/api/trainings/${id}/participants?pid=${p.id}`, "DELETE");
    load();
  }

  const stats = useMemo(() => {
    if (!t) return null;
    const perDay = t.days.map((d) => t.participants.filter((p) => marks.get(`${p.id}|${d}`) === true).length);
    const perPerson = t.participants.map((p) => {
      const marked = t.days.filter((d) => marks.has(`${p.id}|${d}`));
      const present = marked.filter((d) => marks.get(`${p.id}|${d}`)).length;
      return marked.length ? Math.round((present / marked.length) * 100) : null;
    });
    return { perDay, perPerson };
  }, [t, marks]);

  function exportDay(day: string) {
    if (!t) return;
    downloadCSV(`${t.name}-attendance-${day}.csv`, [
      ["Emp ID", "Name", "Email", "Training", "Date", "Status"],
      ...t.participants.map((p) => {
        const v = marks.get(`${p.id}|${day}`);
        return [p.emp_id, p.name, p.email, t.name, day, v === undefined ? "Not marked" : v ? "Present" : "Absent"];
      }),
    ]);
  }

  function exportAll() {
    if (!t) return;
    downloadCSV(`${t.name}-attendance.csv`, [
      ["Emp ID", "Name", "Email", ...t.days, "Attendance %"],
      ...t.participants.map((p, i) => [p.emp_id, p.name, p.email,
        ...t.days.map((d) => { const v = marks.get(`${p.id}|${d}`); return v === undefined ? "" : v ? "P" : "A"; }),
        stats?.perPerson[i] ?? ""]),
    ]);
  }

  if (err) return <div className="card error">{err} <Link href="/trainings">Back</Link></div>;
  if (!t) return <div className="empty"><span className="spin" /></div>;
  const setF = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const todayIn = t.days.includes(today);

  return (
    <div>
      <p className="small" style={{ margin: "0 0 8px" }}><Link href="/trainings">← Training tracker</Link></p>
      <div className="pagehead">
        <div>
          <div className="row"><h1>{t.name}</h1><span className={statusClass(t.status)}>{t.status}</span></div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {[t.trainer, t.mode, t.location].filter(Boolean).join(" · ") || "No trainer set"} ·{" "}
            {t.start_date ? `${fmtDate(t.start_date)} – ${fmtDate(t.end_date)}` : "Dates not set"}
            {t.start_time && ` · ${t.start_time}–${t.end_time}`}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEdit((v) => !v)}>{edit ? "Close" : "Edit details & dates"}</button>
          {todayIn && <button className="btn" onClick={() => exportDay(today)}>Today's CSV for LMS</button>}
          <button className="btn" onClick={exportAll} disabled={!t.participants.length}>Export sheet</button>
        </div>
      </div>

      {edit && (
        <div className="card stack" style={{ marginBottom: 16 }}>
          <div className="grid3">
            <label>Training name<input value={form.name || ""} onChange={(e) => setF("name", e.target.value)} /></label>
            <label>Trainer<input value={form.trainer || ""} onChange={(e) => setF("trainer", e.target.value)} /></label>
            <label>Requested by<input value={form.requested_by || ""} onChange={(e) => setF("requested_by", e.target.value)} /></label>
            <label>Start date<input type="date" value={form.start_date || ""} onChange={(e) => setF("start_date", e.target.value)} /></label>
            <label>End date<input type="date" value={form.end_date || ""} onChange={(e) => setF("end_date", e.target.value)} /></label>
            <label>Mode
              <select value={form.mode || ""} onChange={(e) => setF("mode", e.target.value)}>
                <option value=""></option><option>Online</option><option>In-person</option><option>Hybrid</option>
              </select>
            </label>
            <label>Start time<input type="time" value={form.start_time || ""} onChange={(e) => setF("start_time", e.target.value)} /></label>
            <label>End time<input type="time" value={form.end_time || ""} onChange={(e) => setF("end_time", e.target.value)} /></label>
            <label>Location / link<input value={form.location || ""} onChange={(e) => setF("location", e.target.value)} /></label>
            <label>Status
              <select value={form.status_override || ""} onChange={(e) => setF("status_override", e.target.value)}>
                <option value="">Automatic (from dates)</option><option>On Hold</option><option>Cancelled</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.skip_weekends !== false} onChange={(e) => setF("skip_weekends", e.target.checked)} />
            Skip Saturdays and Sundays in the attendance sheet
          </label>
          <label>Notes<textarea rows={2} value={form.notes || ""} onChange={(e) => setF("notes", e.target.value)} /></label>
          <p className="small muted" style={{ margin: 0 }}>Attendance already marked on a day stays saved even if you move the dates.</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={saveDetails}>Save</button>
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Attendance <span className="muted">· {t.participants.length} people · {t.days.length} days</span></h2>
        <span className="spacer" />
        <button className="btn sm" onClick={() => setAddOpen((v) => !v)}>+ Participants</button>
        <button className="btn sm" onClick={() => fileRef.current?.click()}>Import from Excel</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ""; }} />
      </div>

      {addOpen && (
        <div className="card stack" style={{ marginBottom: 12 }}>
          <label>Paste participants — one per line: Name, Emp ID, Email (any order; copy straight from Excel works)
            <textarea rows={5} value={pasteList} onChange={(e) => setPasteList(e.target.value)}
              placeholder={"Priya Sharma, 2001234, priya.s@company.com\nArjun Rao\t2001240"} />
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" disabled={!pasteList.trim()} onClick={fromPaste}>Add</button>
          </div>
        </div>
      )}

      {!t.days.length ? (
        <div className="card empty">Set a start date to get the attendance sheet. <button className="btn sm" onClick={() => setEdit(true)}>Set dates</button></div>
      ) : !t.participants.length ? (
        <div className="card empty">Add participants to start marking attendance.</div>
      ) : (
        <>
          <p className="small muted" style={{ margin: "0 0 8px" }}>Tap a cell: blank → P → A → blank. Use “All P” on a day to mark everyone present, then tap the absentees.</p>
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="sticky w-name">Participant</th>
                  <th className="w-xs">%</th>
                  {t.days.map((d) => {
                    const l = dayLabel(d);
                    return (
                      <th key={d} ref={d === today ? todayRef : undefined} className={d === today ? "daycol today" : "daycol"}>
                        <span className="dayhead">{l.top}</span>
                        <span className="dayhead" style={{ color: "var(--ink)" }}>{d === today ? "Today" : l.bottom}</span>
                        <span className="dayacts">
                          <button className="mini" onClick={() => setMark(t.participants.map((p) => p.id), d, true)}>All P</button>
                          <button className="mini" title="Download this day for the LMS" onClick={() => exportDay(d)}>⇩</button>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {t.participants.map((p, i) => (
                  <tr key={p.id}>
                    <td className="sticky cell-pad">
                      <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                          <div className="small muted">{p.emp_id}</div>
                        </div>
                        <button className="btn ghost sm danger" onClick={() => removePerson(p)} aria-label={`Remove ${p.name}`}>✕</button>
                      </div>
                    </td>
                    <td className="cell-pad pct" style={{ textAlign: "center" }}>
                      {stats?.perPerson[i] === null ? "—" : `${stats?.perPerson[i]}%`}
                    </td>
                    {t.days.map((d) => {
                      const v = marks.get(`${p.id}|${d}`);
                      return (
                        <td key={d} className={d === today ? "today" : ""} style={{ textAlign: "center" }}>
                          <button className={`att ${v === undefined ? "n" : v ? "p" : "a"}`} onClick={() => cycle(p.id, d)}
                            aria-label={`${p.name} ${d}`}>
                            {v === undefined ? "·" : v ? "P" : "A"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="sticky cell-pad"><b>Present</b></td>
                  <td></td>
                  {t.days.map((d, j) => (
                    <td key={d} className={d === today ? "cell-pad today" : "cell-pad"} style={{ textAlign: "center" }}>
                      <b>{stats?.perDay[j]}</b><span className="muted">/{t.participants.length}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
