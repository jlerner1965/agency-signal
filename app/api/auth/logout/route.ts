import { clearDashboardSession } from "@/app/dashboard-auth";

export async function POST() {
  await clearDashboardSession();
  return Response.json({ ok: true });
}
