"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function TenantForm() {
  const router = useRouter();
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legalName, displayName: displayName || legalName, timezone,
          requestKey: requestKey.current ?? (requestKey.current = crypto.randomUUID())
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Tenant setup failed");
      router.replace("/");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tenant setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <label htmlFor="legalName">Legal business name</label>
    <input id="legalName" required minLength={2} maxLength={200} value={legalName}
      onChange={(event) => setLegalName(event.target.value)} />
    <label htmlFor="displayName">Display name</label>
    <input id="displayName" maxLength={120} value={displayName}
      onChange={(event) => setDisplayName(event.target.value)} placeholder="Defaults to legal name" />
    <label htmlFor="timezone">Business time zone</label>
    <select id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
      <option value="America/Chicago">Central</option>
      <option value="America/New_York">Eastern</option>
      <option value="America/Denver">Mountain</option>
      <option value="America/Los_Angeles">Pacific</option>
      <option value="America/Phoenix">Arizona</option>
      <option value="America/Anchorage">Alaska</option>
      <option value="Pacific/Honolulu">Hawaii</option>
    </select>
    <button type="submit" disabled={busy}>{busy ? "Creating workspace…" : "Create company workspace"}</button>
    {message && <p className="form-message" role="alert">{message}</p>}
  </form>;
}
