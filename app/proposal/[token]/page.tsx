import ProposalView from "./proposal-view";

export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProposalView token={token} />;
}
