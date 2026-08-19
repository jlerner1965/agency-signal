// Worker bindings win over process.env so hosted secrets resolve first, with
// local `.dev.vars` and Node environments falling back to process.env.
export async function runtimeValue(key: string) {
  const { env } = await import("cloudflare:workers");
  const workerValue = (env as unknown as Record<string, unknown>)[key];
  return typeof workerValue === "string" ? workerValue : process.env[key] ?? "";
}

function titleCase(value: string) {
  return value.replace(/[._-]+/g, " ").trim().split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Name shown in the dashboard and on prospect-facing reports and proposals.
 * Falls back to the login address so a workspace is never branded for someone
 * who does not own it.
 */
export async function workspaceOwnerName() {
  const configured = (await runtimeValue("AGENCYSIGNAL_OWNER_NAME")).trim();
  if (configured) return configured.slice(0, 80);
  const email = (await runtimeValue("AGENCYSIGNAL_LOGIN_EMAIL")).trim();
  const local = email.split("@")[0] ?? "";
  return titleCase(local).slice(0, 80) || "AgencySignal";
}
