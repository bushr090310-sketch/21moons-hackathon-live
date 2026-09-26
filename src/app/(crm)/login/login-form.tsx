"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { Wordmark } from "@/components/brand";
import { supabase } from "@/lib/supabase/client";

const PROVIDER_LABEL = { github: "GitHub", linkedin_oidc: "LinkedIn" } as const;

export function LoginForm({ next, notice, providers }: { next: string; notice: string | null; providers: ("github" | "linkedin_oidc")[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(
    notice === "confirm" ? "If you just confirmed your email, sign in with your password." : null,
  );

  const callback = (n: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(n)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const sb = supabase();
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        if (!consent) throw new Error("Please accept the privacy notice to create an account.");
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: callback("/me"), data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/me");
          router.refresh();
        } else {
          setInfo("Check your inbox and click the confirmation link, then sign in. Your profile is linked to this email.");
          setMode("signin");
        }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback("/me/password") });
        if (error) throw error;
        setInfo("If that email has an account, a reset link is on its way.");
        setMode("signin");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: "github" | "linkedin_oidc") {
    setError(null);
    const { error } = await supabase().auth.signInWithOAuth({ provider, options: { redirectTo: callback(next) } });
    if (error) setError(error.message);
  }

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Wordmark size="md" />
        <p className="text-sm text-mist">
          {mode === "signup" ? "Create your 21Moons profile" : mode === "reset" ? "Reset your password" : "Sign in to 21Moons"}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-ink/80 p-5">
        {mode === "signup" && (
          <label className="block">
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required maxLength={120} />
          </label>
        )}
        <label className="block">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {mode !== "reset" && (
          <label className="block">
            <Label hint={mode === "signup" ? "min. 8 characters" : undefined}>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 8 : undefined}
              required
            />
          </label>
        )}
        {mode === "signup" && (
          <label className="flex items-start gap-2 text-xs text-mist">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>
              I agree that 21Moons stores my profile for running its hackathons and community. It is internal only — never
              shared externally without my separate opt-in — and I can edit or delete it at any time.
            </span>
          </label>
        )}
        {error && <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        {info && <p className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{info}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
        </Button>
        {providers.length > 0 && mode !== "reset" && (
          <div className="space-y-2 border-t border-line pt-4">
            {providers.map((p) => (
              <Button key={p} type="button" className="w-full" onClick={() => oauth(p)}>
                Continue with {PROVIDER_LABEL[p]}
              </Button>
            ))}
          </div>
        )}
      </form>
      <div className="mt-4 flex justify-between text-sm text-mist">
        {mode === "signin" ? (
          <>
            <button onClick={() => setMode("signup")} className="hover:text-silver">Create an account</button>
            <button onClick={() => setMode("reset")} className="hover:text-silver">Forgot password?</button>
          </>
        ) : (
          <button onClick={() => setMode("signin")} className="hover:text-silver">← Back to sign in</button>
        )}
      </div>
    </div>
  );
}
