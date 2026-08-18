"use client";

import { FormEvent, useEffect, useState } from "react";

type Payload = {
  proposal: { title: string; service: string; outcome: string; scope: string; deliverables: string[]; price: number; timeline: string; status: string; expiresAt: string; acceptedAt: string | null };
  lead: { agencyName: string; contactName: string; city: string; state: string };
};

export default function ProposalView({ token }: { token: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "accepted">("idle");

  useEffect(() => {
    fetch(`/api/proposals/${encodeURIComponent(token)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Proposal unavailable"); return body; })
      .then((body) => { setPayload(body); if (body.proposal.status === "Accepted") setState("accepted"); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Proposal unavailable"));
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("sending"); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch(`/api/proposals/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setState("idle"); setError(result.error || "Unable to accept proposal"); return; }
    setState("accepted");
  }

  if (error && !payload) return <main className="proposal-state"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><section><p className="eyebrow">Proposal</p><h1>This proposal is unavailable.</h1><p>{error}</p></section></main>;
  if (!payload) return <main className="proposal-state"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><section><span className="report-loader" /><p>Loading proposal…</p></section></main>;

  const { proposal, lead } = payload;
  return <main className="proposal-shell">
    <header className="proposal-nav"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span>Prepared for {lead.agencyName}</span></header>
    <section className="proposal-hero"><div className="proposal-container"><p className="eyebrow">Digital growth proposal</p><h1>{proposal.title}</h1><p>{proposal.outcome}</p><div className="proposal-summary"><span>Investment<strong>${proposal.price.toLocaleString("en-US")}</strong></span><span>Timeline<strong>{proposal.timeline}</strong></span><span>Valid until<strong>{new Date(proposal.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong></span></div></div></section>
    <section className="proposal-container proposal-body"><div><p className="eyebrow">Why this work</p><h2>A focused response to an identified opportunity.</h2><p>{proposal.scope}</p><p>This scope is designed to improve a measurable customer-acquisition outcome without adding work that is not tied to the stated objective.</p></div><aside><span>Recommended service</span><strong>{proposal.service}</strong><small>Prepared by James Lerner</small></aside></section>
    <section className="proposal-deliverables"><div className="proposal-container"><p className="eyebrow">Included</p><h2>Deliverables and implementation</h2><ol>{proposal.deliverables.map((item, index) => <li key={item}><span>0{index + 1}</span><strong>{item}</strong></li>)}</ol></div></section>
    <section className="proposal-accept"><div className="proposal-container"><div><p className="eyebrow">Decision</p><h2>Approve the project.</h2><p>Submitting acceptance records your approval and contact information. James will follow up with the kickoff details and formal service agreement.</p></div>{state === "accepted" ? <div className="proposal-accepted" role="status"><span>✓</span><strong>Proposal accepted</strong><p>Thank you. The next step is project kickoff and scheduling.</p></div> : <form onSubmit={accept}><label>Authorized name<input name="signerName" required autoComplete="name" defaultValue={lead.contactName} /></label><label>Email<input name="signerEmail" type="email" required autoComplete="email" /></label>{error && <p className="form-error">{error}</p>}<button disabled={state === "sending"}>{state === "sending" ? "Recording acceptance…" : `Accept proposal · $${proposal.price.toLocaleString("en-US")}`}</button><small>Acceptance is recorded with the date, name, and email provided.</small></form>}</div></section>
    <footer className="proposal-footer"><div className="proposal-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span>Evidence-led digital growth proposals</span></div></footer>
  </main>;
}
