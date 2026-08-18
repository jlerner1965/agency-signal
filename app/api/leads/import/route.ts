import { or, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";

function makeToken() { return crypto.randomUUID().replaceAll("-", ""); }
function normalizeWebsite(value: string) {
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(normalized);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Website must use http or https");
  return url.toString();
}

type ImportLead = { agencyName?: string; website?: string; contactName?: string; carrier?: string; city?: string; state?: string; email?: string; phone?: string; notes?: string };

export async function POST(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leads?: ImportLead[] };
    const rows = Array.isArray(body.leads) ? body.leads.slice(0, 500) : [];
    if (!rows.length) return Response.json({ error: "No CSV rows were found." }, { status: 400 });
    const db = await getDb();
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      const agencyName = String(row.agencyName ?? "").trim();
      const websiteInput = String(row.website ?? "").trim();
      if (!agencyName || !websiteInput) { skipped += 1; continue; }
      let website: string;
      try { website = normalizeWebsite(websiteInput); } catch { skipped += 1; continue; }
      const email = String(row.email ?? "").trim().toLowerCase();
      const duplicate = await db.select({ id: leads.id }).from(leads).where(
        email ? or(eq(leads.website, website), eq(leads.email, email)) : eq(leads.website, website),
      ).limit(1);
      if (duplicate.length) { skipped += 1; continue; }
      const [lead] = await db.insert(leads).values({
        agencyName,
        website,
        contactName: String(row.contactName ?? "").trim(),
        carrier: String(row.carrier ?? "Uncategorized").trim() || "Uncategorized",
        city: String(row.city ?? "").trim(),
        state: String(row.state ?? "").trim(),
        email,
        phone: String(row.phone ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
        status: "Identified",
        reportToken: makeToken(),
      }).returning();
      await db.insert(activities).values({ leadId: lead.id, activityType: "lead_imported", description: "Business imported from CSV" });
      imported += 1;
    }
    return Response.json({ imported, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import CSV";
    return Response.json({ error: message }, { status: 500 });
  }
}
