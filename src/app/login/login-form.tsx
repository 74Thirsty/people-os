"use client";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + "/auth/callback" }
      });
      if (error) throw error;
      setMessage("Check your email for the secure sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start sign-in.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <label htmlFor="email">Work email</label>
    <input id="email" type="email" autoComplete="email" required value={email}
      onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
    <button type="submit" disabled={busy}>{busy ? "Sending link…" : "Email me a sign-in link"}</button>
    {message && <p className="form-message" role="status">{message}</p>}
  </form>;
}
