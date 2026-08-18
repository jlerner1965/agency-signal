import { createDashboardSession, verifyDashboardCredentials } from "@/app/dashboard-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email ?? "").slice(0, 180);
    const password = String(body.password ?? "").slice(0, 256);
    if (!(await verifyDashboardCredentials(email, password))) {
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await createDashboardSession(email);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Login is temporarily unavailable." }, { status: 500 });
  }
}
