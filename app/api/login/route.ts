import { NextResponse } from "next/server";

async function token(pw: string) {
  const data = new TextEncoder().encode("tth:" + pw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const pw = process.env.APP_PASSWORD;
  if (!pw || password !== pw) return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("tth", await token(pw), {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 60,
  });
  return res;
}
