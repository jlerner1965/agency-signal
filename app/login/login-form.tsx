"use client";

import { FormEvent, useState } from "react";

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Login failed");
      window.location.assign(returnTo);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login failed");
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
      <section className="login-card">
        <div><p className="eyebrow">Private audit workspace</p><h1>Welcome back.</h1><p>Sign in to review websites, score Google presence, and create evidence-backed proposals.</p></div>
        <form onSubmit={submit}>
          <label>Email address<input name="email" type="email" autoComplete="username" required autoFocus /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="login-note">Protected with a secure, time-limited session. Prospect reports do not require this login.</p>
      </section>
    </main>
  );
}
