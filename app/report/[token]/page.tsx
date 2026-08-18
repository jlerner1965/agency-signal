import ReportView from "./report-view";

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReportView token={token} />;
}
