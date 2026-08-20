"use client";

import { FormEvent, useEffect, useState } from "react";
import type { PublicReportLead } from "@/lib/types";
import EngineReport, { type EngineReport as EngineReportData } from "./engine-report";

/**
 * What the public brief carries: the prospect it names, and the run behind it.
 *
 * The findings, the audit block, the comparison, the competitor set and the
 * opportunity all left with the legacy body that was the only thing rendering
 * them. Sending them to a public endpoint that had no use for them was giving
 * away more than the page needed.
 */
type ReportPayload = { lead: PublicReportLead; engine: EngineReportData | null };

export default function ReportView({ token, ownerName }: { token: string; ownerName: string }) {
  const ownerFirstName = ownerName.split(/\s+/)[0];
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent">("idle");
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    fetch(`/api/reports/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const report = await response.json();
        if (!response.ok) throw new Error(report.error || "Report unavailable");
        return report as ReportPayload;
      })
      .then(setPayload)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Report unavailable"));
  }, [token]);

  async function requestReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("sending");
    setRequestError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(token)}/inquiry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request could not be sent");
      setRequestState("sent");
    } catch (reason) {
      setRequestState("idle");
      setRequestError(reason instanceof Error ? reason.message : "Request could not be sent");
    }
  }

  if (error) {
    return (
      <main className="report-state">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <section><p className="eyebrow">Secure report</p><h1>We couldn’t open this report.</h1><p>{error}. Check that the complete link was copied from the sender.</p></section>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="report-state loading-report">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <section><span className="report-loader" /><p>Loading verified findings…</p></section>
      </main>
    );
  }

  const { lead, engine } = payload;

  if (engine) {
    return (
      <main className="report-shell">
        <header className="report-nav"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span className="confidential">Private digital opportunity brief</span></header>
        <section className="report-hero">
          <div className="report-container report-hero-grid">
            <div>
              <p className="eyebrow">Prepared for {lead.contactName || lead.agencyName}</p>
              <h1>{lead.agencyName}<br /><span>Digital Opportunity Brief</span></h1>
              <p className="report-intro">A review of what this business publicly sells, what its Google presence represents, and where the two do not match.</p>
            </div>
          </div>
        </section>
        <EngineReport report={engine} businessName={lead.agencyName} />
        <section className="report-cta"><div className="report-container report-cta-inner">
          <div>
            <p className="eyebrow">Recommended next step</p>
            <h2>Review the findings together in 15 minutes.</h2>
            <p>I&rsquo;ll explain which changes are worth prioritising, what can be fixed quickly, and where a larger rebuild would actually be justified.</p>
          </div>
          {requestState === "sent"
            ? <div className="request-success" role="status"><strong>Request received.</strong><span>{ownerFirstName} will follow up using the email you provided.</span></div>
            : <form className="review-form" onSubmit={requestReview}>
                <label>Your name<input name="name" autoComplete="name" required /></label>
                <label>Email<input name="email" type="email" autoComplete="email" required /></label>
                <label className="span-two">What would you like to discuss?<textarea name="message" rows={3} placeholder="Optional" /></label>
                {requestError && <p className="form-error">{requestError}</p>}
                <button className="report-primary span-two" disabled={requestState === "sending"}>{requestState === "sending" ? "Sending…" : "Request a review"}</button>
              </form>}
        </div></section>
        <footer className="report-footer"><div className="report-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><p>Evidence-led digital opportunity briefs for growing businesses.</p><span>Prepared by {ownerName}</span></div></footer>
      </main>
    );
  }
  // No finished run, no document. This used to fall through to a second,
  // older report body built from the `audits` tables — which have had no
  // writer since the legacy scoring path was removed, so it rendered a
  // prospect-facing page with a score, zero findings and no evidence behind
  // any of it. Saying the brief is not ready is the honest version of that.
  return (
    <main className="report-state">
      <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
      <section>
        <p className="eyebrow">Prepared for {lead.contactName || lead.agencyName}</p>
        <h1>This brief is not ready yet.</h1>
        <p>The review of {lead.agencyName} has not finished. Once it has, this page will carry what was read from the site, what the Google profile represents, and where the two do not line up.</p>
      </section>
    </main>
  );
}
