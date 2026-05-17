"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/shared/Logo";
import { RoleBadge } from "@/components/shared/RoleBadge";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";
import type { AnyProfile, Role } from "@/lib/types";
import { initials } from "@/lib/utils/format";
import { Badge } from "@/components/ui/Badge";

interface TopBarProps {
  profile: AnyProfile;
}

const NAV: Record<Role, { label: string; href: string; icon: React.ReactNode }[]> = {
  taxpayer: [
    { label: "Overview", href: "/dashboard", icon: <Icon.Filing size={14} /> },
    {
      label: "Connections",
      href: "/connections",
      icon: <Icon.Link size={14} />,
    },
  ],
  consultant: [
    { label: "Overview", href: "/dashboard", icon: <Icon.Filing size={14} /> },
    {
      label: "Clients",
      href: "/connections",
      icon: <Icon.Users size={14} />,
    },
  ],
};

export function TopBar({ profile }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const signOut = useAuthStore((s) => s.signOut);
  const session = useAuthStore((s) => s.session);
  const items = NAV[profile.role];

  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        !menuRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const onSignOut = () => {
    signOut();
    router.replace("/login");
  };

  const identifier =
    profile.role === "taxpayer"
      ? profile.identity.panMasked
      : `ICAI ${profile.credentials.icaiMembership}`;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-raised/85 backdrop-blur supports-[backdrop-filter]:bg-surface-raised/70">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" aria-label="Glimmora dashboard">
            <Logo size="sm" />
          </Link>
          <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {items.map((it) => {
              const active = pathname === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-navy-tint text-navy-deep"
                      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  {it.icon}
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line bg-surface-sunken/60 px-3 py-1 text-2xs text-ink-muted md:inline-flex">
            <Icon.Clock size={12} />
            <span>
              Session ·{" "}
              {session
                ? Math.max(
                    0,
                    Math.ceil(
                      (new Date(session.expiresAt).getTime() - Date.now()) /
                        60000,
                    ),
                  )
                : 0}
              m
            </span>
          </span>
          <RoleBadge role={profile.role} identifier={identifier} />

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface-raised pl-1 pr-3 shadow-sm transition-colors hover:bg-surface-sunken"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-2xs font-semibold tracking-widest text-white"
              >
                {initials(profile.displayName, 2)}
              </span>
              <span className="hidden text-sm font-medium text-ink sm:inline">
                {profile.displayName}
              </span>
              <Icon.ChevronRight
                size={12}
                className={cn(
                  "text-ink-muted transition-transform",
                  menuOpen && "rotate-90",
                )}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-line bg-surface-raised shadow-elevated animate-scale-in"
              >
                <div className="border-b border-line-subtle px-4 py-3">
                  <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                    Signed in as
                  </p>
                  <p className="mt-0.5 truncate text-sm font-medium text-ink">
                    {profile.displayName}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {session?.displayIdentifier}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="success" withDot size="sm">
                      Verified
                    </Badge>
                    <Badge tone="navy" size="sm">
                      {profile.role === "taxpayer" ? "Taxpayer" : "Consultant"}
                    </Badge>
                  </div>
                </div>
                <ul className="grid gap-px bg-line-subtle">
                  <li className="bg-surface-raised">
                    <Link
                      href="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-surface-sunken"
                    >
                      <Icon.Filing size={14} /> Overview
                    </Link>
                  </li>
                  <li className="bg-surface-raised">
                    <Link
                      href="/connections"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-surface-sunken"
                    >
                      <Icon.Link size={14} />{" "}
                      {profile.role === "consultant" ? "Clients" : "Connections"}
                    </Link>
                  </li>
                  <li className="bg-surface-raised">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignOut();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-signal-error hover:bg-signal-error-soft/50"
                    >
                      <Icon.Logout size={14} /> Sign out
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <nav
        className="container flex items-center gap-1 overflow-x-auto border-t border-line-subtle py-1 lg:hidden"
        aria-label="Primary mobile"
      >
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                active
                  ? "bg-navy-tint text-navy-deep"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              {it.icon}
              {it.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
