"use client";
import {useState} from "react";

type Props={tenantId:string;revision:number;initialConfiguration:unknown;canEdit:boolean};
export default function ConfigurationEditor({tenantId,revision:initialRevision,initialConfiguration,canEdit}:Props) {
  const [revision,setRevision]=useState(initialRevision);
  const [value,setValue]=useState(JSON.stringify(initialConfiguration,null,2));
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function save() {
    setMessage("");
    let configuration:unknown;
    try { configuration=JSON.parse(value); }
    catch { setMessage("The JSON is not valid. Correct it before saving."); return; }
    setBusy(true);
    try {
      const response=await fetch(`/api/tenants/${tenantId}/configuration`,{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({expectedRevision:revision,configuration})
      });
      const result=await response.json();
      if(!response.ok) throw new Error(result.error ?? "Save failed");
      setRevision(result.revision);
      setMessage(`Saved successfully. Configuration revision ${result.revision}.`);
    } catch(error) {
      setMessage(error instanceof Error?error.message:"Unable to save configuration.");
    } finally { setBusy(false); }
  }
  return <section className="panel" style={{marginTop:"1.5rem"}}>
    <div className="section-row"><h2 className="section">Company configuration JSON</h2><span className="role">Revision {revision}</span></div>
    <p className="note">{canEdit?"Only company owners and administrators can save changes.":"Read-only access. Contact a company owner or administrator to make changes."} Never place passwords, API keys, bank details, tax identifiers, or private keys in this document.</p>
    <textarea aria-label="Company configuration JSON" spellCheck={false} readOnly={!canEdit}
      value={value} onChange={event=>setValue(event.target.value)}
      style={{width:"100%",minHeight:"65vh",fontFamily:"ui-monospace,monospace",fontSize:"0.85rem",padding:"1rem",borderRadius:"0.5rem",border:"1px solid var(--border, #ccc)",background:"var(--surface, #fff)",color:"inherit"}}/>
    {canEdit && <div style={{marginTop:"1rem"}}><button className="button-primary" type="button" disabled={busy} onClick={save}>{busy?"Saving…":"Validate and save configuration"}</button></div>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
