"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";

// Target of the password-reset email (the callback route has already signed the user in).
export default function NewPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace("/crm");
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-10 max-w-sm space-y-4 rounded-xl border border-line bg-ink/80 p-5">
      <h1 className="text-lg font-semibold">Set a new password</h1>
      <label className="block">
        <Label hint="min. 8 characters">New password</Label>
        <Input type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} className="w-full">Save password</Button>
    </form>
  );
}
