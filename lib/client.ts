"use client";

export async function api<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) { location.href = "/login"; throw new Error("Locked"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/** Turns Excel/typed date values into YYYY-MM-DD. Day-first for ambiguous dd/mm/yyyy (India). */
export function toISODate(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(+v)) {
    // Excel dates arrive as UTC midnight
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[\s-]*([A-Za-z]{3})[A-Za-z]*[\s,-]*(\d{4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

export function toTime(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(11, 16);
  if (typeof v === "number" && v < 1) {
    const mins = Math.round(v * 1440);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const t = String(v).trim();
  const m = t.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
  if (!m) return t;
  let h = Number(m[1]);
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]?.replace(/^./, (c) => c.toUpperCase())} ${y}`;
}

export function todayIST(): string {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

const norm = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Finds the header row and maps columns using a synonym table. */
export function mapRows(rows: unknown[][], synonyms: Record<string, string[]>): Record<string, unknown>[] {
  let headerIdx = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm);
    const found: Record<string, number> = {};
    const taken = new Set<number>();
    // exact header matches first, then "contains" matches, earlier synonyms winning
    for (const pass of ["exact", "contains"] as const) {
      for (const [key, syns] of Object.entries(synonyms)) {
        if (key in found) continue;
        for (const sy of syns) {
          const idx = cells.findIndex((c, j) => c && !taken.has(j) && (pass === "exact" ? c === sy : sy.length > 3 && c.includes(sy)));
          if (idx >= 0) { found[key] = idx; taken.add(idx); break; }
        }
      }
    }
    if (Object.keys(found).length >= 2) { headerIdx = i; colMap = found; break; }
  }
  if (headerIdx < 0) return [];
  return rows.slice(headerIdx + 1)
    .filter((r) => r.some((c) => c !== null && c !== ""))
    .map((r) => Object.fromEntries(Object.entries(colMap).map(([k, i]) => [k, r[i]])));
}

export const TRAINING_COLUMNS: Record<string, string[]> = {
  name: ["trainingname", "training", "coursename", "course", "program", "topic", "title"],
  trainer: ["trainername", "trainer", "faculty", "instructor"],
  requested_by: ["requestedby", "requester", "team", "requestor", "spoc", "account", "bu"],
  mode: ["mode", "delivery", "type"],
  location: ["location", "venue", "room", "link"],
  start_date: ["startdate", "fromdate", "from", "start", "date"],
  end_date: ["enddate", "todate", "to", "end"],
  start_time: ["starttime", "fromtime", "timefrom"],
  end_time: ["endtime", "totime", "timeto"],
  notes: ["notes", "remarks", "comments"],
};

export const PARTICIPANT_COLUMNS: Record<string, string[]> = {
  emp_id: ["empid", "employeeid", "employeeno", "empno", "empcode", "id"],
  name: ["employeename", "participantname", "name", "fullname"],
  email: ["email", "emailid", "mail"],
};

export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text();
    return text.split(/\r?\n/).map((line) => {
      const out: string[] = []; let cur = ""; let quoted = false;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    });
  }
  const { readSheet } = await import("read-excel-file/web-worker");
  return (await readSheet(file)) as unknown[][];
}

export function downloadCSV(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => {
    const v = String(c ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const statusClass = (st: string) => "pill pill-" + st.toLowerCase().replace(/\s+/g, "-");
