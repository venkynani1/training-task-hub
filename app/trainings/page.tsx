"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  api, mapRows, readSpreadsheet, toISODate, toTime, TRAINING_COLUMNS, downloadCSV, statusClass, fmtDate,
} from "@/lib/client";
import { trainingStatus } from "@/lib/status";

type Training = {
  id: number; name: string; trainer: string; requested_by: string; mode: string; location: string;
  start_date: string | null; end_date: string | null; start_time: string; end_time: string;
  skip_weekends: boolean; status_override: string; notes: string; status: string;
  participants: number; days_marked: number; total_days: number;
};

const FIELDS: { key: keyof Training; label: string; type?: string; w: string; options?: string[] }[] = [
  { key: "name", label: "Training name", w: "w-name" },
  { key: "trainer", label: "Trainer", w: "w-mid" },
  { key: "requested_by", label: "Requested by", w: "w-mid" },
  { key: "mode", label: "Mode", w: "w-sm", options: ["", "Online", "In-person", "Hybrid"] },
  { key: "location", label: "Location / link", w: "w-mid" },
  { key: "start_date", label: "Start date", type: "date", w: "w-mid" },
  { key: "end_date", label: "End date", type: "date", w: "w-mid" },
  { key: "start_time", label: "From", type: "time", w: "w-sm" },
  { key: "end_time", label: "To", type: "time", w: "w-sm" },
];
const FILTERS = ["All", "Scheduled", "Ongoing", "Completed", "On Hold", "Cancelled"];

export default function TrackerPage() {
  const [rows, setRows] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const load = useCallback(async () => {
    try { setRows(await api<Training[]>("/api/trainings")); setErr(""); }
    catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(t: Training, key: keyof Training, value: unknown) {
    if ((t[key] ?? "") === value) return;
    const change: Partial<Training> = { [key]: value };
    // keep end date sane when the start moves past it
    if (key === "start_date" && value && (!t.end_date || t.end_date < String(value))) change.end_date = String(value);
    const next = { ...t, ...change };
    next.status = trainingStatus(next);
    setRows((all) => all.map((x) => (x.id === t.id ? next : x)));
    try { await api(`/api/trainings/${t.id}`, "PATCH", change); }
    catch (e) { alert((e as Error).message); load(); }
  }

  async function addRow() {
    if (!draftName.trim()) return;
    await api("/api/trainings", "POST", { name: draftName.trim() });
    setDraftName(""); load();
  }

  async function remove(t: Training) {
    if (!confirm(`Delete "${t.name}" with its participants and attendance?`)) return;
    await api(`/api/trainings/${t.id}`, "DELETE");
    load();
  }

  async function pickFile(file: File) {
    try {
      const data = await readSpreadsheet(file);
      const mapped = mapRows(data, TRAINING_COLUMNS)
        .map((r) => ({
          ...r,
          name: String(r.name ?? "").trim(),
          start_date: toISODate(r.start_date),
          end_date: toISODate(r.end_date),
          start_time: toTime(r.start_time),
          end_time: toTime(r.end_time),
        }))
        .filter((r) => r.name);
      if (!mapped.length) {
        alert("Couldn't find a header row with a Training Name column. Download the template to see the expected columns.");
        return;
      }
      setPreview(mapped);
    } catch (e) { alert("Couldn't read that file: " + (e as Error).message); }
  }

  async function doImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const r = await api<{ count: number }>("/api/trainings", "POST", { rows: preview });
      setPreview(null); flash(`Imported ${r.count} trainings`); load();
    } catch (e) { alert((e as Error).message); } finally { setImporting(false); }
  }

  function exportSheet() {
    downloadCSV("training-tracker.csv", [
      ["Training Name", "Trainer", "Requested By", "Mode", "Location", "Start Date", "End Date",
        "Start Time", "End Time", "Status", "Participants", "Days Marked", "Total Days", "Notes"],
      ...rows.map((t) => [t.name, t.trainer, t.requested_by, t.mode, t.location, t.start_date || "",
        t.end_date || "", t.start_time, t.end_time, t.status, t.participants, t.days_marked, t.total_days, t.notes]),
    ]);
  }

  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "All" ? rows.length : rows.filter((r) => r.status === f).length]));
  const shown = rows.filter((r) =>
    (filter === "All" || r.status === filter) &&
    (!query || `${r.name} ${r.trainer} ${r.requested_by}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1>Training tracker</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Click any cell to edit. Status follows the dates — set On Hold or Cancelled in the Status column.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => downloadCSV("training-schedule-template.csv", [
            ["Training Name", "Trainer", "Requested By", "Mode", "Location", "Start Date", "End Date", "Start Time", "End Time", "Notes"],
            ["Java Full Stack – Batch 3", "Ravi Kumar", "Banking Delivery", "Online", "Teams", "17-11-2026", "28-11-2026", "10:00", "13:00", ""],
          ])}>Template</button>
          <button className="btn" onClick={exportSheet}>Export</button>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Import Excel schedule</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
        </div>
      </div>

      {err && <div className="card error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="tabs" style={{ flex: 1, marginBottom: 0 }}>
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "tab active" : "tab"} onClick={() => setFilter(f)}>
              {f} <span className="muted">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input style={{ maxWidth: 220 }} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sticky">#</th>
              {FIELDS.map((f) => <th key={f.key} className={f.w}>{f.label}</th>)}
              <th className="w-mid">Status</th>
              <th className="w-xs">People</th>
              <th className="w-sm">Attendance</th>
              <th className="w-mid">Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={FIELDS.length + 6} className="empty"><span className="spin" /></td></tr>}
            {shown.map((t, i) => (
              <tr key={t.id}>
                <td className="sticky rownum">{i + 1}</td>
                {FIELDS.map((f) => (
                  <td key={f.key}>
                    {f.options ? (
                      <select defaultValue={String(t[f.key] ?? "")} onChange={(e) => save(t, f.key, e.target.value)}>
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input key={`${t.id}-${f.key}-${t[f.key]}`} type={f.type || "text"}
                        defaultValue={String(t[f.key] ?? "")}
                        onBlur={(e) => save(t, f.key, f.type === "date" ? e.target.value || null : e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                    )}
                  </td>
                ))}
                <td className="cell-pad">
                  <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
                    <span className={statusClass(t.status)}>{t.status}</span>
                    <select className="mini" style={{ width: "auto", minWidth: 0, padding: "2px 4px" }} title="Hold or cancel"
                      value={t.status_override || ""} onChange={(e) => save(t, "status_override", e.target.value)}>
                      <option value="">Auto</option>
                      <option value="On Hold">On Hold</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                </td>
                <td className="cell-pad" style={{ textAlign: "center" }}>{t.participants}</td>
                <td className="cell-pad">
                  <Link href={`/trainings/${t.id}`}>{t.total_days ? `${t.days_marked}/${t.total_days} days` : "Open"}</Link>
                </td>
                <td><input key={`${t.id}-notes-${t.notes}`} defaultValue={t.notes} onBlur={(e) => save(t, "notes", e.target.value)} /></td>
                <td className="cell-pad"><button className="btn ghost sm danger" onClick={() => remove(t)} aria-label="Delete">✕</button></td>
              </tr>
            ))}
            <tr>
              <td className="sticky rownum">+</td>
              <td colSpan={FIELDS.length + 5}>
                <input placeholder="Type a new training name and press Enter…" value={draftName}
                  onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRow()}
                  onBlur={addRow} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal stack" style={{ maxWidth: 900 }}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Import {preview.length} trainings?</h2>
              <button className="btn ghost" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="sheet-wrap" style={{ maxHeight: 360 }}>
              <table className="sheet">
                <thead><tr><th>Training</th><th>Trainer</th><th>Start</th><th>End</th><th>Time</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td className="cell-pad">{String(r.name)}</td>
                      <td className="cell-pad">{String(r.trainer ?? "")}</td>
                      <td className="cell-pad">{fmtDate(r.start_date as string)}</td>
                      <td className="cell-pad">{fmtDate((r.end_date || r.start_date) as string)}</td>
                      <td className="cell-pad">{[r.start_time, r.end_time].filter(Boolean).join("–")}</td>
                      <td className="cell-pad"><span className={statusClass(trainingStatus(r as any))}>{trainingStatus(r as any)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Dates like 17-11-2026 are read as day-month-year. You can fix any cell after importing.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
              <button className="btn primary" disabled={importing} onClick={doImport}>
                {importing ? <span className="spin" /> : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
