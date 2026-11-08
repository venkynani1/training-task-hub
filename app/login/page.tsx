"use client";
import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }),
    });
    if (res.ok) location.href = "/";
    else setErr("That passcode didn't match.");
  }
  return (
    <form onSubmit={go} className="card login">
      <div className="brand"><span className="brand-mark">T</span> Training Task Hub</div>
      <label>Passcode
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary">Open</button>
    </form>
  );
}
