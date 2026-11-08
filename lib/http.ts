import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(e: unknown, status = 500) {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg }, { status });
}

export const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
export const d = (v: unknown) => {
  const t = s(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
