"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  api, readSpreadsheet, readSheetSmart, toISODate, toTime, downloadCSV, statusClass, fmtDate,
} from "@/lib/client";
import { trainingStatus, applyCategoryRules, MASTERCLASS_TIME, trainingKey } from "@/lib/status";

type Training = {
  id: number; name: string; category: string; trainer: string; requested_by: string; mode: string; location: string;
  start_date: string | null; end_date: string | null; start_time: string; end_time: string;
  skip_weekends: boolean; status_override: string; notes: string; status: string;
  participants: number; days_marked: number; total_days: number;
};

const FIELDS: { key: keyof Training; label: string; type?: string; w: string; options?: string[] }[] = [
  { key: "name", label: "Training name", w: "w-name" },
  { key: "category", label: "Section", w: "w-mid", options: ["Demand Based", "Masterclass", "Ctadel"] },
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
const SECTIONS = [
  { key: "All", label: "All trainings" },
  { key: "Demand Based", label: "Demand Based" },
  { key: "Masterclass", label: "Masterclasses" },
  { key: "Ctadel", label: "Ctadel" },
];
const isFixedTime = (t: { category?: string }, key: string) =>
  t.category === "Masterclass" && (key === "start_time" || key === "end_time");

export default function TrackerPage() {
  const [rows, setRows] = useState<Training[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("All");
  const [section, setSection] = useState("All");
  useEffect(() => { try { const v = localStorage.getItem("tth-section"); if (v) setSection(v); } catch {} }, []);
  const pickSection = (v: string) => { setSection(v); try { localStorage.setItem("tth-section", v); } catch {} };
  const newCategory = section === "All" ? "Demand Based" : section;
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [reading, setReading] = useState("");
  const [previewMode, setPreviewMode] = useState<{ mode: string; error?: string }>({ mode: "ai" });
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
    if (key === "category" && value === "Masterclass") Object.assign(change, MASTERCLASS_TIME);
    const next = applyCategoryRules({ ...t, ...change });
    next.status = trainingStatus(next);
    setRows((all) => all.map((x) => (x.id === t.id ? next : x)));
    try { await api(`/api/trainings/${t.id}`, "PATCH", change); }
    catch (e) { alert((e as Error).message); load(); }
  }

  async function addRow() {
    if (!draftName.trim()) return;
    await api("/api/trainings", "POST", { name: draftName.trim(), category: newCategory });
    setDraftName(""); load();
  }

  async function remove(t: Training) {
    if (!confirm(`Delete "${t.name}" with its participants and attendance?`)) return;
    await api(`/api/trainings/${t.id}`, "DELETE");
    load();
  }

  async function pickFile(file: File) {
    setReading("Opening sheet…");
    try {
      const data = await readSpreadsheet(file);
      const result = await readSheetSmart(data, {
        kind: "trainings", section: newCategory, fileName: file.name, onProgress: setReading,
      });
      const mapped = result.items
        .map((r) => ({
          ...r,
          name: String(r.name ?? "").trim(),
          start_date: toISODate(r.start_date),
          end_date: toISODate(r.end_date),
          start_time: toTime(r.start_time),
          end_time: toTime(r.end_time),
          category: r.category ? String(r.category) : newCategory,
          status_override: /hold|postpon/i.test(String(r.status_override ?? "")) ? "On Hold"
            : /cancel|drop/i.test(String(r.status_override ?? "")) ? "Cancelled" : "",
          ...Object.fromEntries(["trainer", "requested_by", "mode", "location", "notes"]
            .map((k) => [k, String(r[k] ?? "").trim()])),
        }))
        .map((r) => applyCategoryRules(r))
        .filter((r) => r.name);
      if (!mapped.length) {
        alert(result.mode === "basic"
          ? `Couldn't find any trainings in that sheet${result.error ? ` (AI unavailable: ${result.error})` : ""}. Download the template to see the expected columns.`
          : "The AI didn't find any trainings in that sheet.");
        return;
      }
      setPreviewMode(result);
      setPreview(mapped);
    } catch (e) { alert("Couldn't read that file: " + (e as Error).message); }
    finally { setReading(""); }
  }

  async function doImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const r = await api<{ added: number; updated: number; skipped: number }>("/api/trainings", "POST", { rows: preview });
      setPreview(null);
      flash([`${r.added} added`, r.updated && `${r.updated} already there (updated)`, r.skipped && `${r.skipped} repeated in sheet`]
        .filter(Boolean).join(" · "));
      load();
    } catch (e) { alert((e as Error).message); } finally { setImporting(false); }
  }

  function exportSheet() {
    downloadCSV(`training-tracker${section === "All" ? "" : "-" + section.toLowerCase().replace(/\s+/g, "-")}.csv`, [
      ["Training Name", "Section", "Trainer", "Requested By", "Mode", "Location", "Start Date", "End Date",
        "Start Time", "End Time", "Status", "Participants", "Days Marked", "Total Days", "Notes"],
      ...inSection.map((t) => [t.name, t.category, t.trainer, t.requested_by, t.mode, t.location, t.start_date || "",
        t.end_date || "", t.start_time, t.end_time, t.status, t.participants, t.days_marked, t.total_days, t.notes]),
    ]);
  }

  const existingKeys = new Set(rows.filter((r) => r.start_date).map((r) => trainingKey(r.name, r.category, r.start_date)));
  const previewTag: ("new" | "update" | "repeat")[] = [];
  {
    const seenKeys = new Set<string>();
    for (const r of preview || []) {
      const k = trainingKey(r.name, r.category, r.start_date);
      previewTag.push(seenKeys.has(k) ? "repeat" : existingKeys.has(k) ? "update" : "new");
      seenKeys.add(k);
    }
  }
  const previewCounts = { new: 0, update: 0, repeat: 0 };
  previewTag.forEach((t) => previewCounts[t]++);
  const inSection = rows.filter((r) => section === "All" || r.category === section);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, f === "All" ? inSection.length : inSection.filter((r) => r.status === f).length]));
  const shown = inSection.filter((r) =>
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
            ["Training Name", "Section", "Trainer", "Requested By", "Mode", "Location", "Start Date", "End Date", "Start Time", "End Time", "Notes"],
            ["Java Full Stack – Batch 3", "Demand Based", "Ravi Kumar", "Banking Delivery", "Online", "Teams", "17-11-2026", "28-11-2026", "10:00", "13:00", ""],
            ["GenAI for Testers", "Masterclass", "Anu Priya", "", "Online", "Teams", "20-11-2026", "20-11-2026", "15:00", "16:00", "Masterclasses are always 3–4 PM"],
            ["Ctadel Cohort 2 – Week 1", "Ctadel", "", "", "In-person", "Chennai", "24-11-2026", "28-11-2026", "", "", ""],
          ])}>Template</button>
          <button className="btn" onClick={exportSheet}>Export</button>
          <button className="btn primary" disabled={!!reading} onClick={() => fileRef.current?.click()}>
            {reading ? <><span className="spin" /> Reading…</> : "Import Excel schedule"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
        </div>
      </div>

      {err && <div className="card error" style={{ marginBottom: 12 }}>{err}</div>}
      {reading && <div className="note" style={{ marginBottom: 12 }}><span className="spin" /> {reading}</div>}

      <div className="segments" role="tablist">
        {SECTIONS.map((sec) => (
          <button key={sec.key} role="tab" aria-selected={section === sec.key}
            className={section === sec.key ? "segment active" : "segment"} onClick={() => pickSection(sec.key)}>
            {sec.label}
            <span className="segment-count">{sec.key === "All" ? rows.length : rows.filter((r) => r.category === sec.key).length}</span>
          </button>
        ))}
      </div>
      {section === "Masterclass" && (
        <p className="small muted" style={{ margin: "-4px 0 10px" }}>Masterclasses always run 3:00–4:00 PM — times are set automatically.</p>
      )}

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
                    {isFixedTime(t, f.key) ? (
                      <span className="cell-pad fixed" title="Masterclasses always run 3–4 PM">{f.key === "start_time" ? "3:00 PM" : "4:00 PM"}</span>
                    ) : f.options ? (
                      <select key={`${t.id}-${f.key}-${t[f.key]}`} defaultValue={String(t[f.key] ?? "")} onChange={(e) => save(t, f.key, e.target.value)}>
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
                <input placeholder={`Type a new ${section === "Masterclass" ? "masterclass" : section === "Ctadel" ? "Ctadel training" : "training"} name and press Enter…`} value={draftName}
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
              <h2 style={{ margin: 0 }}>
                {previewCounts.new} new{previewCounts.update ? `, ${previewCounts.update} already in tracker` : ""}
                {previewCounts.repeat ? `, ${previewCounts.repeat} repeated` : ""}
              </h2>
              <span className="small muted">Rows without a Section column go to {newCategory}.</span>
              <button className="btn ghost" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="sheet-wrap" style={{ maxHeight: 360 }}>
              <table className="sheet">
                <thead><tr><th></th><th>Training</th><th>Section</th><th>Trainer</th><th>Start</th><th>End</th><th>Time</th><th>Status</th><th>Requested by</th><th>Location</th><th>Notes</th></tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} style={previewTag[i] === "new" ? undefined : { opacity: .6 }}>
                      <td className="cell-pad">
                        {previewTag[i] === "new" ? <span className="pill pill-completed">New</span>
                          : previewTag[i] === "update" ? <span className="pill pill-scheduled">Already there</span>
                          : <span className="pill pill-cancelled">Repeat</span>}
                      </td>
                      <td className="cell-pad">{String(r.name)}</td>
                      <td className="cell-pad">{String(r.category)}</td>
                      <td className="cell-pad">{String(r.trainer ?? "")}</td>
                      <td className="cell-pad">{fmtDate(r.start_date as string)}</td>
                      <td className="cell-pad">{fmtDate((r.end_date || r.start_date) as string)}</td>
                      <td className="cell-pad">{[r.start_time, r.end_time].filter(Boolean).join("–")}</td>
                      <td className="cell-pad"><span className={statusClass(trainingStatus(r as any))}>{trainingStatus(r as any)}</span></td>
                      <td className="cell-pad">{String(r.requested_by ?? "")}</td>
                      <td className="cell-pad">{String(r.location ?? "")}</td>
                      <td className="cell-pad small muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={String(r.notes ?? "")}>{String(r.notes ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewMode.mode === "ai" && <div className="note">✦ Read with AI — check the dates and sections below before importing.</div>}
            {previewMode.mode !== "ai" && (
              <div className="note" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                {previewMode.mode === "basic" ? "AI reading wasn't available" : "AI couldn't read part of the sheet"}
                {previewMode.error ? ` (${previewMode.error})` : ""}, so {previewMode.mode === "basic" ? "columns were" : "those rows were"} matched by header names instead. Check the rows below.
              </div>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              A training with the same name, section and start date counts as already there. Those rows only refresh its details, so uploading the same sheet twice won't create copies.
            </p>
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
