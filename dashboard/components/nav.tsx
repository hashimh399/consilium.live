"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/leads", label: "Leads" },
  { href: "/test-drives", label: "Test Drives" },
  { href: "/service", label: "Service" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-zinc-900 text-zinc-100">
      <div className="px-6 py-6">
        <p className="text-lg font-semibold tracking-tight">Consilium</p>
        <p className="text-xs text-zinc-400">AI Voice Agent</p>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1 px-3">
        {links.map((link) => {
          const active =
            pathname === link.href ||
            (link.href !== "/" && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                active
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto px-6 py-6 text-xs text-zinc-500">
        Demo dashboard
      </div>
    </aside>
  );
}
