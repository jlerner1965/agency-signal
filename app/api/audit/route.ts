import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { analyzeWebsitePages, extractBusinessMetadata, extractInternalLinks, mergeLighthouseAudit } from "@/lib/site-audit";
import { buildOpportunity } from "@/lib/opportunity";

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^(127|10|0)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function safeUrl(input: string) {
  const value = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) {
    throw new Error("Please enter a public http or https website.");
  }
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Custom website ports are not supported.");
  url.hash = "";
  return url;
}

async function fetchPage(input: string, signal: AbortSignal) {
  const requested = safeUrl(input);
  const response = await fetch(requested, {
    redirect: "follow",
    signal,
    headers: { "User-Agent": "AgencySignal-Audit/2.0 (+public website opportunity review)" },
  });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML webpage.");
  const finalUrl = safeUrl(response.url || requested.toString()).toString();
  return { url: finalUrl, html: (await response.text()).slice(0, 1_500_000), status: response.status };
}

function categoryScore(categories: Record<string, { score?: number }> | undefined, key: string) {
  const score = categories?.[key]?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

async function fetchLighthouseSnapshot(input: string, signal: AbortSignal) {
  try {
    const params = new URLSearchParams({ url: input, strategy: "mobile", locale: "en" });
    for (const category of ["performance", "accessibility", "seo", "best-practices"]) params.append("category", category);
    const apiKey = process.env.PAGESPEED_API_KEY;
    if (apiKey) params.set("key", apiKey);
    const response = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal });
    if (!response.ok) return null;
    const payload = await response.json() as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>;
        audits?: Record<string, { displayValue?: string }>;
      };
    };
    const categories = payload.lighthouseResult?.categories;
    const audits = payload.lighthouseResult?.audits;
    if (!categories) return null;
    return {
      performance: categoryScore(categories, "performance"),
      accessibility: categoryScore(categories, "accessibility"),
      seo: categoryScore(categories, "seo"),
      bestPractices: categoryScore(categories, "best-practices"),
      lcp: audits?.["largest-contentful-paint"]?.displayValue ?? "",
      inp: audits?.["interaction-to-next-paint"]?.displayValue ?? audits?.["total-blocking-time"]?.displayValue ?? "",
      cls: audits?.["cumulative-layout-shift"]?.displayValue ?? "",
    };
  } catch {
    return null;
  }
}

async function inspectWebsite(input: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const home = await fetchPage(input, controller.signal);
    const lighthousePromise = fetchLighthouseSnapshot(home.url, controller.signal);
    const links = extractInternalLinks(home.html, home.url, 4);
    const secondary = await Promise.allSettled(links.map((url: string) => fetchPage(url, controller.signal)));
    const pages = [home, ...secondary.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchPage>>> => result.status === "fulfilled").map((result) => result.value)];
    const contentAnalysis = analyzeWebsitePages(pages);
    const lighthouse = await lighthousePromise;
    const analysis = mergeLighthouseAudit(contentAnalysis, lighthouse, home.url);
    return { ...analysis, metadata: extractBusinessMetadata(home.html, home.url), finalUrl: home.url, status: home.status };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leadId?: number; website?: string };
    const leadId = Number(body.leadId);
    const website = String(body.website ?? "").trim();
    if (!Number.isInteger(leadId) || !website) return Response.json({ error: "Lead and website are required." }, { status: 400 });

    const db = await getDb();
    const [existingLead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!existingLead) return Response.json({ error: "Lead not found." }, { status: 404 });
    const result = await inspectWebsite(website);
    const [audit] = await db.insert(audits).values({
      leadId,
      website: result.finalUrl,
      score: result.score,
      visibilityScore: result.visibility,
      conversionScore: result.conversion,
      technicalScore: result.technical,
      trustScore: result.trust,
      pagesAudited: result.pagesAudited,
      responseStatus: result.status,
    }).returning();
    if (result.findings.length) {
      await db.insert(auditFindings).values(result.findings.map((finding: Record<string, unknown>) => ({ ...finding, auditId: audit.id })) as typeof auditFindings.$inferInsert[]);
    }
    const [lead] = await db.update(leads).set({
      website: result.finalUrl,
      score: result.score,
      visibilityScore: result.visibility,
      conversionScore: result.conversion,
      technicalScore: result.technical,
      trustScore: result.trust,
      status: "Audited",
      lastAuditAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(leads.id, leadId)).returning();
    const opportunity = buildOpportunity(lead, result.findings);
    await db.insert(activities).values({
      leadId,
      activityType: "audit_completed",
      description: `${result.pagesAudited}-page website audit completed · ${opportunity.primaryService} opportunity · score ${result.score}`,
    });
    return Response.json({ lead, audit, findings: result.findings, pagesAudited: result.pagesAudited, opportunity, lighthouse: result.lighthouse, metadata: result.metadata });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The website took too long to complete a multi-page review."
      : error instanceof Error ? error.message : "Unable to complete the audit.";
    return Response.json({ error: message }, { status: 400 });
  }
}
