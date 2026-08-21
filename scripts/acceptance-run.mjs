#!/usr/bin/env node
// Drives a full prospect audit end to end against a running instance and
// reports whether the result is one you could put in front of a client.
//
//   node scripts/acceptance-run.mjs \
//     --base http://localhost:5173 \
//     --email you@example.com --password '…' \
//     "Name | City | https://example.com" …
//
// Prospects can also come from a JSON file: --file prospects.json holding
// [{ "name": "…", "city": "…", "url": "https://…" }].
//
// Exits non-zero if any prospect fails an acceptance check, so this can gate
// a release rather than only inform one.

import { formatBatch, summarizeBatch } from "../lib/acceptance-summary.js";

const TICK_LIMIT = 60;
const TICK_PAUSE_MS = 5000;

function readFlags(argv) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const match = argv[index].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) { rest.push(argv[index]); continue; }
    if (match[2] !== undefined) { flags[match[1]] = match[2]; continue; }
    const next = argv[index + 1];
    flags[match[1]] = next !== undefined && !next.startsWith("--") ? argv[++index] : "";
  }
  return { flags, rest };
}

const { flags, rest } = readFlags(process.argv.slice(2));
const base = (flags.base || "http://localhost:5173").replace(/\/$/, "");

/**
 * The sign-in, without needing it on the command line.
 *
 * A long invocation carrying a quoted password is exactly the thing a terminal
 * mangles on paste, and one unclosed quote swallows everything typed after it.
 * The email is already on the machine that deployed this, in `.dev.vars`, and
 * the password can be typed rather than pasted — so neither has to be in the
 * command, or in shell history.
 */
async function readDevVar(key) {
  try {
    const { readFile } = await import("node:fs/promises");
    const file = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
    const line = file.split("\n").find((entry) => entry.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  } catch {
    return "";
  }
}

/** Typed, not echoed. Mirrors the prompt in scripts/setup-credentials.mjs. */
async function promptSecret(question) {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  if (!stdin.isTTY) return "";
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const original = stdout.write.bind(stdout);
  stdout.write(question);
  rl.output.write = (chunk, encoding, callback) => { if (callback) callback(); };
  const answer = await rl.question("");
  rl.output.write = original;
  stdout.write("\n");
  rl.close();
  return answer;
}

const email = flags.email || process.env.AGENCYSIGNAL_LOGIN_EMAIL || (await readDevVar("AGENCYSIGNAL_LOGIN_EMAIL"));
const password = flags.password
  || process.env.AGENCYSIGNAL_LOGIN_PASSWORD
  || (email ? await promptSecret(`Password for ${email}: `) : "");

async function loadProspects() {
  if (flags.file) {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(flags.file, "utf8"));
  }
  // "Name | City | https://url" is the shape that survives a shell argument.
  return rest.map((spec) => {
    const [name, city, url] = spec.split("|").map((part) => part.trim());
    return { name, city, url };
  });
}

let cookie = "";

async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers },
    redirect: "manual",
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  // The session cookie arrives once, on login, and every later call needs it.
  if (setCookie.length) cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }
  return { ok: response.ok, status: response.status, payload };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value) => (typeof value === "number" ? `$${value.toLocaleString("en-US")}` : String(value));

/** Runs one prospect from creation to a finished proposal. */
async function auditProspect(prospect) {
  const notes = [];
  const fail = (message) => { notes.push({ ok: false, message }); };
  const pass = (message) => { notes.push({ ok: true, message }); };

  const created = await api("/api/leads", {
    method: "POST",
    body: JSON.stringify({ agencyName: prospect.name, website: prospect.url, city: prospect.city ?? "" }),
  });
  if (!created.ok) throw new Error(`Could not create the prospect: ${created.payload.error ?? created.status}`);
  const lead = created.payload.lead;

  const started = await api("/api/audit-runs", { method: "POST", body: JSON.stringify({ leadId: lead.id }) });
  if (!started.ok) throw new Error(`Could not start the run: ${started.payload.error ?? started.status}`);
  const runId = started.payload.run.id;

  // No queue binding, so the run advances one module per request. Retries wait
  // across ticks, which is why a tick that changes nothing is not a failure.
  let run = started.payload.run;
  let ticks = 0;
  while (ticks < TICK_LIMIT) {
    ticks += 1;
    const ticked = await api(`/api/audit-runs/${runId}/tick`, { method: "POST" });
    run = ticked.payload.run ?? run;
    if (/^(Complete|Failed|Blocked)/.test(run.status ?? "")) break;
    await sleep(TICK_PAUSE_MS);
  }

  const summary = (await api(`/api/audit-runs/${runId}`)).payload;
  run = summary.run;

  // 1. Reachability, stated separately from score. An unreadable site must
  //    never read as a bad one.
  const diagnostics = summary.diagnostics ?? {};
  if (run.reachable === false) fail(`Site could not be read — ${run.error || "no reason recorded"}`);
  else pass(`Site read: ${diagnostics.pagesReached ?? "?"}/${diagnostics.pagesAttempted ?? "?"} pages, robots ${diagnostics.robotsFetchable ? "fetchable" : "not fetchable"}, ${diagnostics.pagesDisallowed ?? 0} disallowed`);

  // What blocked us, and how. This is the evidence the blocking-rate question
  // needs and a pass/fail line cannot carry: which server answered, with what
  // status, and whether the navigation was even in the served HTML.
  for (const blocked of diagnostics.blockedResponses ?? []) {
    let path = blocked.url;
    try { path = new URL(blocked.url).pathname; } catch { /* print it as stored */ }
    notes.push({ ok: true, quiet: true, message: `Blocked: HTTP ${blocked.status} on ${path}${blocked.server ? ` · server ${blocked.server}` : ""}${blocked.cfRay ? " · Cloudflare" : ""}` });
  }
  if (diagnostics.navigationServerRendered === false) {
    notes.push({ ok: true, quiet: true, message: "Navigation is JS-rendered, not in the served HTML" });
  }
  if (diagnostics.truncatedBy) {
    notes.push({ ok: true, quiet: true, message: `Crawl truncated by ${diagnostics.truncatedBy}` });
  }

  // 2. A score, or an honest refusal to give one.
  if (run.overallScore === null) fail(`No score reported (${run.confidence}% of rubric verified, ${run.checksVerified}/${run.checksTotal} in-scope checks) — ${run.error}`);
  else pass(`Score ${run.overallScore} at ${run.confidence}% confidence (${run.checksVerified}/${run.checksTotal} in-scope checks)`);

  // 3. The thing this tool exists for: services the site sells that the
  //    Google presence does not represent.
  const serviceModule = (summary.modules ?? []).find((module) => module.module === "service-lines");
  const coverageFindings = (summary.findings ?? []).filter((finding) => finding.category === "Service coverage");
  // A site we could not read produces a "could not be assessed" finding. That
  // is the right thing for the report to say and the wrong thing to count as
  // coverage detection, or this check passes hardest when it measured least.
  if (run.reachable === false) fail(`Service coverage not assessable — the site could not be read`);
  else if (!coverageFindings.length) fail(`No service-coverage findings — ${serviceModule?.message ?? "module did not report"}`);
  else pass(`${coverageFindings.length} service-coverage finding(s): ${coverageFindings.slice(0, 3).map((finding) => finding.title).join("; ")}`);

  const recs = await api(`/api/audit-runs/${runId}/recommendations`, { method: "POST" });
  if (!recs.ok) fail(`Recommendations failed: ${recs.payload.error}`);

  // Mockups before the proposal: the proposal links them, and a rebuild
  // replaces their tokens.
  const mockups = await api(`/api/audit-runs/${runId}/mockups`, { method: "POST" });
  if (!mockups.ok) fail(`Mockups failed: ${mockups.payload.error}`);

  const proposalCall = await api(`/api/audit-runs/${runId}/proposal`, { method: "POST", body: "{}" });
  if (!proposalCall.ok) throw new Error(`Proposal failed: ${proposalCall.payload.error ?? proposalCall.status}`);
  const proposal = proposalCall.payload.proposal;

  // 4. Every recommendation must cite a stored finding.
  // findingIds is stored as JSON text, so a length check on the raw value
  // would measure the string and call every recommendation cited.
  const citedIds = (rec) => (Array.isArray(rec.findingIds) ? rec.findingIds : JSON.parse(rec.findingIds || "[]"));
  const uncited = (recs.payload.recommendations ?? []).filter((rec) => !citedIds(rec).length);
  if (uncited.length) fail(`${uncited.length} recommendation(s) cite no finding`);
  else pass(`${(recs.payload.recommendations ?? []).length} recommendation(s), each citing findings`);

  // 5. An opening in the voice, or a stated reason there is none.
  if (proposal.openingBlocked) fail(`No opening written — ${proposal.openingBlocked}`);
  else pass(`Opening written (${proposal.openingSource})`);

  // 6. A price traceable to config/pricing.json.
  const scopeItems = JSON.parse(proposal.scopeItems || "[]");
  if (!scopeItems.length) fail("Priced with no scope items");
  else pass(`${proposal.priceDisplay || money(proposal.price)}${proposal.minimumApplied ? " (minimum applied)" : ""}: ${scopeItems.map((item) => `${item.label} ${item.band}×${item.quantity}`).join(", ")}`);

  // 7. The concept pages the opening refers to must be linkable.
  const links = JSON.parse(proposal.mockupLinks || "[]");
  if (!links.length) fail("Proposal links no concept pages");
  else {
    const checked = await Promise.all(links.map(async (link) => (await fetch(`${base}${link.url}`)).status));
    const broken = checked.filter((status) => status !== 200).length;
    if (broken) fail(`${broken} of ${links.length} concept page link(s) do not resolve`);
    else pass(`${links.length} concept page(s), all resolving`);
  }

  if (proposalCall.payload.blockers?.length) fail(`Export blocked: ${proposalCall.payload.blockers.join("; ")}`);

  return {
    prospect, runId, ticks, notes, run, diagnostics,
    coverageFindings: coverageFindings.length,
    report: `${base}/report/${lead.reportToken}`,
    proposal: `${base}/proposal/${proposal.token}`,
    mockups: links.map((link) => `${base}${link.url}`),
  };
}

const prospects = await loadProspects();
if (!prospects.length || prospects.some((prospect) => !prospect.name || !prospect.url)) {
  console.error('Give each prospect as "Business name | City | https://url", or pass --file prospects.json.');
  process.exit(64);
}

const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
if (!login.ok) {
  console.error(`Sign-in failed (${login.status}): ${login.payload.error ?? ""}`);
  console.error("Pass --email and --password, or set AGENCYSIGNAL_LOGIN_EMAIL and AGENCYSIGNAL_LOGIN_PASSWORD.");
  process.exit(77);
}

let failures = 0;
const results = [];
for (const prospect of prospects) {
  console.log(`\n${"=".repeat(72)}\n${prospect.name} — ${prospect.url}\n${"=".repeat(72)}`);
  try {
    const result = await auditProspect(prospect);
    results.push(result);
    for (const note of result.notes) {
      // Quiet notes are evidence, not verdicts: what blocked the crawl is
      // worth printing and is not a failure of this prospect's audit.
      console.log(`  ${note.quiet ? "····" : note.ok ? "PASS" : "FAIL"}  ${note.message}`);
      if (!note.ok) failures += 1;
    }
    console.log(`\n  run ${result.runId} in ${result.ticks} ticks`);
    console.log(`  report   ${result.report}`);
    console.log(`  proposal ${result.proposal}`);
    for (const mockup of result.mockups) console.log(`  mockup   ${mockup}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${error instanceof Error ? error.message : error}`);
  }
}

if (results.length) {
  console.log(`\n${"=".repeat(72)}`);
  for (const line of formatBatch(summarizeBatch(results))) console.log(line);
}

console.log(`\n${failures ? `${failures} acceptance check(s) failed.` : "All acceptance checks passed."}`);
process.exit(failures ? 1 : 0);
