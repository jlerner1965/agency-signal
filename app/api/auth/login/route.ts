import { createDashboardSession, dashboardAuthConfigured, verifyDashboardCredentials } from "@/app/dashboard-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email ?? "").slice(0, 180);
    const password = String(body.password ?? "").slice(0, 256);
    // Without this the first run of a fresh checkout only ever reports a wrong
    // password, with nothing to say that no login exists yet.
    if (!(await dashboardAuthConfigured())) {
      return Response.json(
        { error: "This workspace has no login yet. Run `npm run auth:credentials` locally, or set the AGENCYSIGNAL_LOGIN_EMAIL, _PASSWORD_SALT, _PASSWORD_HASH, and _SESSION_SECRET secrets in the hosted runtime." },
        { status: 503 },
      );
    }
    if (!(await verifyDashboardCredentials(email, password))) {
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    await createDashboardSession(email);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Login is temporarily unavailable." }, { status: 500 });
  }
}
