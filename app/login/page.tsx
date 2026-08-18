import { redirect } from "next/navigation";
import { getDashboardSession, safeReturnTo } from "../dashboard-auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).return_to);
  if (await getDashboardSession()) redirect(returnTo);
  return <LoginForm returnTo={returnTo} />;
}
