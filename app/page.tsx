import Dashboard from "./dashboard";
import { requireDashboardUser } from "./dashboard-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireDashboardUser("/");
  return <Dashboard ownerName="James Lerner" />;
}
