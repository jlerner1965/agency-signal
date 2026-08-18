import ProposalView from "./proposal-view";
import { workspaceOwnerName } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProposalView token={token} ownerName={await workspaceOwnerName()} />;
}
