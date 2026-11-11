"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type PolicyOption = { id: string; name: string; status: string; sourceStatus: string };

export default function ConfigEditor({
  tenantId,
  canEdit,
  canManageStatus,
  config,
  policies
}: {
  tenantId: string;
  canEdit: boolean;
  canManageStatus: boolean;
  config: {
    operatingName: string;
    description: string;
    website: string | null;
    contactEmail: string | null;
    contactTelephone: string | null;
  };
  policies: PolicyOption[];
}) {
  const router = useRouter();
  const [operatingName, setOperatingName] = useState(config.operatingName);
  const [description, setDescription] = useState(config.description);
  const [website, setWebsite] = useState(config.website ?? "");
  const [contactEmail, setContactEmail] = useState(config.contactEmail ?? "");
  const [contactTelephone, setContactTelephone] = useState(config.contactTelephone ?? "");
  const [statuses, setStatuses] = useState<Record<string, string>>(
    Object.fromEntries(policies.map((policy) => [policy.id, policy.status]))
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!canEdit) return;
    const body: Record<string, unknown> = {};
    if (operatingName !== config.operatingName) body.operatingName = operatingName;
    if (description !== config.description) body.description = description;
    const websiteValue = website.trim() || null;
    if (websiteValue !== config.website) body.website = websiteValue;
    const emailValue = contactEmail.trim() || null;
    if (emailValue !== config.contactEmail) body.contactEmail = emailValue;
    const telephoneValue = contactTelephone.trim() || null;
    if (telephoneValue !== config.contactTelephone) body.contactTelephone = telephoneValue;
    const changedPolicies = policies
      .filter((policy) => statuses[policy.id] !== policy.status)
      .map((policy) => ({ id: policy.id, status: statuses[policy.id] }));
    if (changedPolicies.length > 0) body.policies = changedPolicies;
    if (Object.keys(body).length === 0) {
      setMessage("No changes to publish.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/company/${tenantId}/configuration`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Configuration update failed");
      setMessage(`Published configuration v${result.version}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Configuration update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runHealthCheck() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/company/${tenantId}/integrations/health`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Integration probe failed");
      setMessage(`Microsoft: ${result.readiness.microsoft.state}; communications: ${result.readiness.communications.state}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Integration probe failed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(action: "activate" | "suspend") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/company/${tenantId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.blockers?.length ? `${result.error}: ${result.blockers.join("; ")}` : result.error || "Status change failed");
      }
      setMessage(action === "activate" ? "Tenant activated." : "Tenant suspended.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status change failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel">
    <div className="eyebrow">Authorized administration</div>
    <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <label htmlFor="operatingName">Operating name</label>
      <input id="operatingName" value={operatingName} disabled={!canEdit} maxLength={120}
        onChange={(event) => setOperatingName(event.target.value)} />
      <label htmlFor="description">Business description</label>
      <textarea id="description" value={description} disabled={!canEdit} maxLength={1000} rows={3}
        onChange={(event) => setDescription(event.target.value)} />
      <label htmlFor="website">Website (blank means unconfirmed)</label>
      <input id="website" value={website} disabled={!canEdit} maxLength={300}
        onChange={(event) => setWebsite(event.target.value)} />
      <label htmlFor="contactEmail">Business contact email</label>
      <input id="contactEmail" type="email" value={contactEmail} disabled={!canEdit} maxLength={200}
        onChange={(event) => setContactEmail(event.target.value)} />
      <label htmlFor="contactTelephone">Business contact telephone</label>
      <input id="contactTelephone" value={contactTelephone} disabled={!canEdit} maxLength={50}
        onChange={(event) => setContactTelephone(event.target.value)} />
    </div>

    <h2 style={{ margin: "26px 0 10px", fontSize: 18 }}>HR policy status</h2>
    <p className="note">Only approved or active policies can be enforced. Confirming a policy records your user ID, timestamp, and new configuration version.</p>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th>Policy</th><th>Status</th><th>Provenance</th></tr></thead>
      <tbody>
        {policies.map((policy) => <tr key={policy.id} style={{ borderTop: "1px solid var(--border)" }}>
          <td style={{ padding: "8px 6px" }}><strong>{policy.id}</strong> {policy.name}</td>
          <td>
            <select value={statuses[policy.id]} disabled={!canEdit}
              onChange={(event) => setStatuses((current) => ({ ...current, [policy.id]: event.target.value }))}>
              {policy.status === "proposed" && <option value="proposed" disabled>proposed</option>}
              <option value="requires_confirmation">requires_confirmation</option>
              <option value="approved">approved</option>
              <option value="active">active</option>
              <option value="retired">retired</option>
            </select>
          </td>
          <td>{policy.sourceStatus}</td>
        </tr>)}
      </tbody>
    </table>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
      <button type="button" disabled={busy || !canEdit} onClick={save}>{busy ? "Working…" : "Publish configuration"}</button>
      <button type="button" className="button-secondary" disabled={busy || !canEdit} onClick={runHealthCheck}>Run integration health check</button>
      {canManageStatus && <button type="button" className="button-secondary" disabled={busy} onClick={() => changeStatus("activate")}>Activate tenant</button>}
      {canManageStatus && <button type="button" className="button-secondary" disabled={busy} onClick={() => changeStatus("suspend")}>Suspend tenant</button>}
    </div>
    {!canEdit && <p className="note">Your role has read-only access to company configuration.</p>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
