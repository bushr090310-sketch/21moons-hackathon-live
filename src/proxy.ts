import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

// Refreshes the Supabase Auth session for CRM routes only (the live game routes
// never touch Supabase Auth) and sends signed-out visitors to /login.
// Authorization (participant vs staff vs admin) is enforced by RLS and by the
// page-level guards in src/lib/crm/auth.ts — this is only the session gate.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/auth/");
  if (!user && !isPublic && !path.startsWith("/api/")) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  matcher: [
    "/login",
    "/auth/:path*",
    "/me/:path*",
    "/people/:path*",
    "/projects/:path*",
    "/hackathons/:path*",
    "/dashboard/:path*",
    "/import/:path*",
    "/tags/:path*",
    "/crm",
    "/api/account/:path*",
    "/api/crm/:path*",
  ],
};
