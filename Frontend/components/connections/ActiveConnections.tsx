"use client";

import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/format";
import type { LinkGrant } from "@/lib/types";
import { openChatThread } from "@/lib/api/chat";

/**
 * Companion to `ActiveChats`. Lists the user's active (and pending) grant
 * counterparties and lets them open a chat with one click — even before
 * any messages exist. Re-uses the grants the parent already fetched on
 * the Connections page so we don't double-load.
 */
export function ActiveConnections({
  links,
  myRole,
  onOpen,
}: {
  links: LinkGrant[];
  myRole: "consultant" | "taxpayer";
  onOpen: (args: {
    threadId: string;
    counterpartyId: string;
    counterpartyName: string;
    counterpartyRole: "consultant" | "taxpayer";
  }) => void;
}) {
  const [opening, setOpening] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const active = React.useMemo(
    () => links.filter((l) => l.status === "active" || l.status === "pending"),
    [links],
  );

  const handleChat = async (grant: LinkGrant) => {
    setError(null);
    const counterpartyId =
      myRole === "taxpayer" ? grant.consultantId : grant.taxpayerId;
    const counterpartyName =
      myRole === "taxpayer" ? grant.consultantName : grant.taxpayerName;
    if (!counterpartyId) {
      setError("This connection is missing the counterparty id.");
      return;
    }
    setOpening(grant.id);
    try {
      const thread = await openChatThread(counterpartyId);
      onOpen({
        threadId: thread.id,
        counterpartyId,
        counterpartyName,
        counterpartyRole: myRole === "taxpayer" ? "consultant" : "taxpayer",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open chat.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <section
      aria-label="Active connections"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface-raised p-5"
    >
      <header>
        <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
          Active connections
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.005em] text-ink">
          {myRole === "taxpayer" ? "Your consultants" : "Your taxpayers"}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          One click opens a private chat with anyone you're connected to.
        </p>
      </header>

      {error && (
        <Alert tone="error" compact>
          {error}
        </Alert>
      )}

      {active.length === 0 ? (
        <Empty myRole={myRole} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((g) => (
            <li key={g.id}>
              <ConnectionRow
                grant={g}
                myRole={myRole}
                opening={opening === g.id}
                onChat={() => void handleChat(g)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectionRow({
  grant,
  myRole,
  opening,
  onChat,
}: {
  grant: LinkGrant;
  myRole: "consultant" | "taxpayer";
  opening: boolean;
  onChat: () => void;
}) {
  const name = myRole === "taxpayer" ? grant.consultantName : grant.taxpayerName;
  const sub =
    myRole === "taxpayer"
      ? grant.consultantFirm ?? "Independent practice"
      : `PAN ${grant.taxpayerPanMasked}`;
  const isActive = grant.status === "active";
  const counterpartyRoleLabel =
    myRole === "taxpayer" ? "Consultant" : "Taxpayer";
  const initials = name
    .replace(/^CA\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-line-subtle bg-surface-raised px-2.5 py-2",
      )}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-navy text-white text-sm font-semibold"
      >
        {initials || <Icon.User size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium tracking-[-0.005em] text-ink">
            {name}
          </p>
          <Badge tone="navy" size="sm">
            {counterpartyRoleLabel}
          </Badge>
          {isActive ? (
            <Badge tone="success" size="sm" withDot>
              Active
            </Badge>
          ) : (
            <Badge tone="warning" size="sm" withDot>
              Pending
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className="truncate text-ink-muted">{sub}</span>
          <span className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
            Requested {formatRelative(grant.requestedAt)}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        variant={isActive ? "primary" : "outline"}
        onClick={onChat}
        loading={opening}
        disabled={opening}
        leftIcon={<Icon.Chat size={12} />}
      >
        Chat
      </Button>
    </div>
  );
}

function Empty({ myRole }: { myRole: "consultant" | "taxpayer" }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-sunken/40 px-4 py-6 text-center">
      <span
        aria-hidden
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-navy"
      >
        <Icon.Users size={14} />
      </span>
      <p className="mt-2 text-sm font-medium text-ink">No connections yet</p>
      <p className="mt-1 text-xs text-ink-muted text-pretty">
        {myRole === "taxpayer"
          ? "Connect with a CA from the directory to start a conversation."
          : "Once a taxpayer connects to you, they'll show up here."}
      </p>
    </div>
  );
}
