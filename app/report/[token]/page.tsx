import ReportView from "./report-view";
import { workspaceOwnerName } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReportView token={token} ownerName={await workspaceOwnerName()} />;
}
