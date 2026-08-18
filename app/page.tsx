import Dashboard from "./dashboard";
import { requireDashboardUser } from "./dashboard-auth";
import { workspaceOwnerName } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireDashboardUser("/");
  return <Dashboard ownerName={await workspaceOwnerName()} />;
}
