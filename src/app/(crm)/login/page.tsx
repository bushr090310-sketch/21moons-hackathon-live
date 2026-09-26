import { redirect } from "next/navigation";
import { getViewer } from "@/lib/crm/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

// OAuth providers are switched on per environment once the provider is configured
// in Supabase (see CLAUDE.md): AUTH_PROVIDERS="github,linkedin_oidc".
function enabledProviders(): ("github" | "linkedin_oidc")[] {
  const raw = (process.env.AUTH_PROVIDERS ?? "").split(",").map((s) => s.trim());
  return (["github", "linkedin_oidc"] as const).filter((p) => raw.includes(p));
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getViewer()) redirect(sp.next?.startsWith("/") ? sp.next : "/crm");
  return <LoginForm next={sp.next ?? "/crm"} notice={sp.notice ?? null} providers={enabledProviders()} />;
}
