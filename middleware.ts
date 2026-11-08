import { NextResponse, type NextRequest } from "next/server";

async function token(pw: string) {
  const data = new TextEncoder().encode("tth:" + pw);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next(); // no passcode set → open
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (req.cookies.get("tth")?.value === (await token(pw))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Locked" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon).*)"] };
