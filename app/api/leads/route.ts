import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { leads } from "@/db/schema";
import { ensureSeedData } from "@/lib/server-data";

function makeToken(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 45);
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function GET() {
  try {
    await ensureSeedData();
    const db = await getDb();
    const rows = await db.select().from(leads).orderBy(desc(leads.updatedAt));
    return Response.json({ leads: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load leads";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const agencyName = String(body.agencyName ?? "").trim();
    const website = String(body.website ?? "").trim();
    const city = String(body.city ?? "").trim();
    if (!agencyName || !website || !city) {
      return Response.json(
        { error: "Agency name, city and website are required." },
        { status: 400 },
      );
    }
    const normalizedWebsite = /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;
    const db = await getDb();
    const [lead] = await db
      .insert(leads)
      .values({
        agencyName,
        website: normalizedWebsite,
        city,
        state: String(body.state ?? "CO").trim() || "CO",
        contactName: String(body.contactName ?? "").trim(),
        carrier: String(body.carrier ?? "Independent").trim() || "Independent",
        email: String(body.email ?? "").trim(),
        phone: String(body.phone ?? "").trim(),
        reportToken: makeToken(agencyName),
      })
      .returning();
    return Response.json({ lead }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create lead";
    return Response.json({ error: message }, { status: 500 });
  }
}
