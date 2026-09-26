"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useRef } from "react";

// GET form that re-submits on every select change (and on Enter in the search box),
// so filters live in the URL and are shareable/bookmarkable.
export function FilterBar({ children, resetHref }: { children: React.ReactNode; resetHref: string }) {
  const router = useRouter();
  const path = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  function apply() {
    const fd = new FormData(ref.current!);
    const qs = new URLSearchParams();
    fd.forEach((v, k) => { if (String(v).trim()) qs.set(k, String(v).trim()); });
    router.replace(`${path}${qs.size ? `?${qs}` : ""}`);
  }
  return (
    <form
      ref={ref}
      onSubmit={(e) => { e.preventDefault(); apply(); }}
      onChange={(e) => { if ((e.target as HTMLElement).tagName === "SELECT") apply(); }}
      className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink/70 p-3 [&_input]:h-9 [&_input]:rounded-md [&_input]:border [&_input]:border-line-strong [&_input]:bg-black/30 [&_input]:px-3 [&_input]:text-sm [&_select]:h-9 [&_select]:max-w-[11rem] [&_select]:rounded-md [&_select]:border [&_select]:border-line-strong [&_select]:bg-ink [&_select]:px-2 [&_select]:text-sm"
    >
      {children}
      <button type="submit" className="h-9 rounded-md border border-line-strong bg-white/[0.05] px-3 text-sm text-silver hover:bg-white/[0.1]">Search</button>
      <Link href={resetHref} className="px-2 text-sm text-mist hover:text-silver">Reset</Link>
    </form>
  );
}
