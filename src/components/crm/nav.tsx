"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import { Wordmark } from "@/components/brand";

type Item = { href: string; label: string };

export function CrmNav({ items, email, role }: { items: Item[]; email: string; role: string }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link href="/crm" className="flex items-center gap-2" aria-label="21Moons CRM">
          <Wordmark size="sm" />
          <span className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-mist">CRM</span>
        </Link>
        <nav className="ml-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition",
                path === n.href || path.startsWith(n.href + "/") ? "bg-white/[0.07] text-silver" : "text-mist hover:text-silver",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden text-right text-xs leading-tight text-dim md:block">
          <div className="text-mist">{email}</div>
          <div className="uppercase tracking-wider">{role}</div>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-md px-2.5 py-1.5 text-sm text-mist hover:bg-white/[0.06] hover:text-silver">Log out</button>
        </form>
      </div>
    </header>
  );
}
