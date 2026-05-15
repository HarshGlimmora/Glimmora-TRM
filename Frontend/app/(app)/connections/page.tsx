"use client";

import * as React from "react";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Input, Field } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { RadioGroup } from "@/components/ui/Radio";
import { Icon } from "@/components/shared/Icon";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  fetchServerConnections,
  listLinksFor,
  requestLink,
  respondToServerGrant,
  updateLinkStatus,
} from "@/lib/api";
import type {
  AccessMode,
  GrantStatus,
  LinkGrant,
} from "@/lib/types";
import {
  sanitizeText,
  sanitizePan,
} from "@/lib/security/sanitize";
import { validatePan } from "@/lib/validation/identity";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { BrowseConsultants } from "@/components/connections/BrowseConsultants";
import { ConnectViaCodeModal } from "@/components/connections/ConnectViaCode";
import { MyInviteCode } from "@/components/connections/MyInviteCode";
import { ActiveChats } from "@/components/connections/ActiveChats";
import { ActiveConnections } from "@/components/connections/ActiveConnections";
import { ChatDrawer, type ChatPeer } from "@/components/chat/ChatDrawer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isServerGrantId = (id: string): boolean => UUID_RE.test(id);

const TAX_YEARS = ["FY 2024-25", "FY 2023-24", "FY 2022-23"];

const STATUS_META: Record<
  GrantStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "error" | "info" }
> = {
  pending: { label: "Awaiting decision", tone: "warning" },
  active: { label: "Active", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
  rejected: { label: "Rejected", tone: "error" },
  expired: { label: "Expired", tone: "neutral" },
};

const MODE_META: Record<AccessMode, { label: string; description: string }> = {
  review_edit: {
    label: "Review & edit",
    description:
      "CA can read and edit your filing, then return it to you. You retain sole authority to submit.",
  },
  full_access: {
    label: "Full access",
    description:
      "CA can edit AND submit on your behalf. Best when you want end-to-end delegation.",
  },
};

export default function ConnectionsPage() {
  const profile = useAuthStore((s) => s.profile);
  const [links, setLinks] = React.useState<LinkGrant[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openNew, setOpenNew] = React.useState(false);
  const [openCode, setOpenCode] = React.useState(false);
  const [modalGrant, setModalGrant] = React.useState<LinkGrant | null>(null);
  const [notice, setNotice] = React.useState<{ kind: "success" | "error" | "info"; msg: string } | null>(null);
  // Chat drawer state — owned at the page level so both the ActiveChats and
  // ActiveConnections cards can request that it open.
  const [chatThreadId, setChatThreadId] = React.useState<string | null>(null);
  const [chatPeer, setChatPeer] = React.useState<ChatPeer | null>(null);
  const [chatRefreshKey, setChatRefreshKey] = React.useState(0);

  const refresh = React.useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    // Pull from both sources: the legacy mock (still drives the PAN-based
    // "Link by PAN" modal flow) and the real backend (drives the new card +
    // 5-digit code flows). Server-backed grants come first so they appear
    // at the top of the lists.
    const myPanMasked =
      profile.role === "taxpayer" ? profile.identity.panMasked : "—";
    const [mockGrants, serverGrants] = await Promise.all([
      listLinksFor(profile.id),
      fetchServerConnections({
        myRole: profile.role,
        myName: profile.displayName,
        myPanMasked,
      }),
    ]);
    const seen = new Set<string>();
    const merged: LinkGrant[] = [];
    for (const g of [...serverGrants, ...mockGrants]) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      merged.push(g);
    }
    setLinks(merged);
    setLoading(false);
  }, [profile]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!profile) return null;
  const isTaxpayer = profile.role === "taxpayer";

  const pending = links.filter((l) => l.status === "pending");
  const active = links.filter((l) => l.status === "active");
  const history = links.filter(
    (l) =>
      l.status === "revoked" ||
      l.status === "rejected" ||
      l.status === "expired",
  );

  const respondTo = async (g: LinkGrant, action: "active" | "rejected") => {
    try {
      if (isServerGrantId(g.id)) {
        await respondToServerGrant({
          grantId: g.id,
          action: action === "active" ? "accept" : "decline",
        });
      } else {
        await updateLinkStatus(g.id, action);
      }
      setNotice({
        kind: action === "active" ? "success" : "info",
        msg:
          action === "active"
            ? "Grant accepted. The counterparty has been notified."
            : "Grant declined. No data is shared.",
      });
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setNotice({ kind: "error", msg });
    }
  };

  const revoke = async (g: LinkGrant) => {
    try {
      if (isServerGrantId(g.id)) {
        await respondToServerGrant({ grantId: g.id, action: "revoke" });
      } else {
        await updateLinkStatus(g.id, "revoked");
      }
      setNotice({
        kind: "info",
        msg: "Access revoked. The counterparty's session no longer has this data.",
      });
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Revoke failed.";
      setNotice({ kind: "error", msg });
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-fade-up">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="micro-label">Connections</p>
          <h1 className="mt-1.5 font-display text-4xl leading-tight text-ink">
            {isTaxpayer
              ? "Your consultants & access grants"
              : "Your taxpayers & engagements"}
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-ink-muted">
            {isTaxpayer
              ? "Grant a CA review-only or full access, scoped per tax year. Every action is recorded in your audit trail and can be revoked instantly."
              : "Open requests appear here for you to accept. Active engagements show the scope and tax years you can work on."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isTaxpayer && (
            <Button
              size="md"
              variant="outline"
              leftIcon={<Icon.Link size={14} />}
              onClick={() => setOpenCode(true)}
            >
              Connect with code
            </Button>
          )}
          <Button
            size="md"
            variant="outline"
            leftIcon={<Icon.Plus size={14} />}
            onClick={() => setOpenNew(true)}
          >
            {isTaxpayer ? "Link by PAN" : "Request a taxpayer"}
          </Button>
        </div>
      </header>

      {isTaxpayer && (
        <div
          aria-label="Connect a consultant"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <BrowseConsultants
            onConnected={(name) => {
              setNotice({
                kind: "success",
                msg: `Request sent to ${name}. They have 14 days to accept.`,
              });
              void refresh();
            }}
          />
          <div className="flex flex-col gap-4">
            <ActiveChats
              refreshKey={chatRefreshKey}
              onOpen={(args) => {
                setChatThreadId(args.threadId);
                setChatPeer({
                  id: args.counterpartyId,
                  name: args.counterpartyName,
                  role: args.counterpartyRole,
                });
              }}
            />
            <ActiveConnections
              links={links}
              myRole="taxpayer"
              onOpen={(args) => {
                setChatThreadId(args.threadId);
                setChatPeer({
                  id: args.counterpartyId,
                  name: args.counterpartyName,
                  role: args.counterpartyRole,
                });
                setChatRefreshKey((k) => k + 1);
              }}
            />
          </div>
        </div>
      )}

      {!isTaxpayer && (
        <>
          <MyInviteCode />
          <div
            aria-label="Conversations"
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <ActiveChats
              refreshKey={chatRefreshKey}
              onOpen={(args) => {
                setChatThreadId(args.threadId);
                setChatPeer({
                  id: args.counterpartyId,
                  name: args.counterpartyName,
                  role: args.counterpartyRole,
                });
              }}
            />
            <ActiveConnections
              links={links}
              myRole="consultant"
              onOpen={(args) => {
                setChatThreadId(args.threadId);
                setChatPeer({
                  id: args.counterpartyId,
                  name: args.counterpartyName,
                  role: args.counterpartyRole,
                });
                setChatRefreshKey((k) => k + 1);
              }}
            />
          </div>
        </>
      )}

      {notice && (
        <Alert
          tone={notice.kind === "success" ? "success" : notice.kind === "error" ? "error" : "info"}
          action={
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-2xs font-medium uppercase tracking-widest text-current/70 hover:text-current"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          }
        >
          {notice.msg}
        </Alert>
      )}

      {loading && (
        <p className="text-sm text-ink-muted">Loading connections…</p>
      )}

      {!loading && (
        <>
          <section aria-label="Pending grants" className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-[-0.005em] text-ink">
                Pending decisions
              </h2>
              <span className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                {pending.length} item{pending.length === 1 ? "" : "s"}
              </span>
            </header>
            {pending.length === 0 ? (
              <EmptyBlock
                title="No pending requests"
                body={
                  isTaxpayer
                    ? "When you initiate a link, it sits here until the CA accepts."
                    : "Taxpayer requests for your services will appear here."
                }
              />
            ) : (
              <div className="grid gap-3">
                {pending.map((g) => (
                  <GrantCard
                    key={g.id}
                    grant={g}
                    role={profile.role}
                    onAccept={
                      // If I'm receiving the request, I can accept/reject
                      g.requestedBy !== profile.role
                        ? () => respondTo(g, "active")
                        : undefined
                    }
                    onReject={
                      g.requestedBy !== profile.role
                        ? () => respondTo(g, "rejected")
                        : undefined
                    }
                    onCancel={
                      g.requestedBy === profile.role
                        ? () => revoke(g)
                        : undefined
                    }
                    onDetails={() => setModalGrant(g)}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-label="Active grants" className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-[-0.005em] text-ink">
                Active engagements
              </h2>
              <span className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                {active.length} item{active.length === 1 ? "" : "s"}
              </span>
            </header>
            {active.length === 0 ? (
              <EmptyBlock
                title="No active connections yet"
                body={
                  isTaxpayer
                    ? "Once a CA accepts your request, they'll appear here with scope and expiry."
                    : "Once you accept a taxpayer's request, they'll appear here."
                }
              />
            ) : (
              <div className="grid gap-3">
                {active.map((g) => (
                  <GrantCard
                    key={g.id}
                    grant={g}
                    role={profile.role}
                    onRevoke={() => revoke(g)}
                    onDetails={() => setModalGrant(g)}
                  />
                ))}
              </div>
            )}
          </section>

          {history.length > 0 && (
            <section aria-label="History" className="flex flex-col gap-3">
              <header className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-[-0.005em] text-ink">
                  History
                </h2>
                <span className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                  {history.length} archived
                </span>
              </header>
              <div className="grid gap-3">
                {history.map((g) => (
                  <GrantCard
                    key={g.id}
                    grant={g}
                    role={profile.role}
                    onDetails={() => setModalGrant(g)}
                    muted
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <NewLinkModal
        open={openNew}
        onClose={() => setOpenNew(false)}
        role={profile.role}
        myName={profile.displayName}
        myId={profile.id}
        onCreated={(notice) => {
          setNotice({ kind: "success", msg: notice });
          void refresh();
        }}
      />

      <GrantDetailModal
        grant={modalGrant}
        onClose={() => setModalGrant(null)}
      />

      <ConnectViaCodeModal
        open={openCode}
        onClose={() => setOpenCode(false)}
        onConnected={() => {
          setNotice({
            kind: "success",
            msg: "Linked. Your consultant now has the agreed scope of access.",
          });
          void refresh();
          setChatRefreshKey((k) => k + 1);
        }}
      />

      <ChatDrawer
        open={chatThreadId !== null}
        onClose={() => setChatThreadId(null)}
        threadId={chatThreadId}
        peer={chatPeer}
        onActivity={() => setChatRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface GrantCardProps {
  grant: LinkGrant;
  role: "taxpayer" | "consultant";
  onAccept?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  onRevoke?: () => void;
  onDetails: () => void;
  muted?: boolean;
}

function GrantCard({
  grant,
  role,
  onAccept,
  onReject,
  onCancel,
  onRevoke,
  onDetails,
  muted,
}: GrantCardProps) {
  const meta = STATUS_META[grant.status];
  const mode = MODE_META[grant.accessMode];
  const counterpartyName =
    role === "taxpayer" ? grant.consultantName : grant.taxpayerName;
  const subline =
    role === "taxpayer"
      ? grant.consultantFirm ?? "Independent practice"
      : `PAN ${grant.taxpayerPanMasked}`;

  return (
    <Card
      className={cn(
        "transition-shadow",
        muted && "opacity-75",
      )}
    >
      <CardBody className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex items-start gap-4 lg:flex-1">
          <span
            aria-hidden
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken text-navy"
          >
            {role === "taxpayer" ? (
              <Icon.Building size={18} />
            ) : (
              <Icon.User size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold tracking-[-0.005em] text-ink">
                {counterpartyName}
              </p>
              <Badge tone={meta.tone} size="sm" withDot>
                {meta.label}
              </Badge>
              <Badge tone="navy" size="sm">
                {mode.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">{subline}</p>
            <dl className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                  Years
                </dt>
                <dd className="font-medium text-ink">
                  {grant.taxYears.join(", ")}
                </dd>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                  Requested by
                </dt>
                <dd className="font-medium text-ink capitalize">
                  {grant.requestedBy}
                </dd>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                  Requested
                </dt>
                <dd className="font-medium text-ink">
                  {formatRelative(grant.requestedAt)}
                </dd>
              </span>
              {grant.expiresAt && (grant.status === "active" || grant.status === "pending") && (
                <span className="inline-flex items-center gap-1.5">
                  <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                    {grant.status === "active" ? "Expires" : "Auto-expires"}
                  </dt>
                  <dd className="font-medium text-ink">
                    {formatDate(grant.expiresAt)}
                  </dd>
                </span>
              )}
            </dl>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDetails}>
            Details
          </Button>
          {onAccept && (
            <Button
              size="sm"
              onClick={onAccept}
              leftIcon={<Icon.Check size={12} />}
            >
              Accept
            </Button>
          )}
          {onReject && (
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              leftIcon={<Icon.X size={12} />}
            >
              Decline
            </Button>
          )}
          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              leftIcon={<Icon.X size={12} />}
            >
              Cancel request
            </Button>
          )}
          {onRevoke && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRevoke}
              leftIcon={<Icon.Lock size={12} />}
              className="border-signal-error/30 text-signal-error hover:bg-signal-error-soft"
            >
              Revoke access
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-sunken/40 px-5 py-8 text-center">
      <span
        aria-hidden
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-raised text-navy"
      >
        <Icon.Info size={16} />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-muted text-pretty">{body}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  New link request modal                                                    */
/* -------------------------------------------------------------------------- */

function NewLinkModal({
  open,
  onClose,
  role,
  myName,
  myId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  role: "taxpayer" | "consultant";
  myName: string;
  myId: string;
  onCreated: (msg: string) => void;
}) {
  const [pan, setPan] = React.useState("");
  const [mode, setMode] = React.useState<AccessMode>("review_edit");
  const [year, setYear] = React.useState(TAX_YEARS[0]);
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPan("");
      setMode("review_edit");
      setYear(TAX_YEARS[0]);
      setMessage("");
      setError(null);
    }
  }, [open]);

  const panErr = (() => {
    if (!pan) return null;
    const r = validatePan(pan);
    return r.ok ? null : r.message;
  })();
  const canSubmit = !panErr && pan.length === 10 && !submitting;

  const submit = async () => {
    setError(null);
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      await requestLink({
        fromRole: role,
        fromUserId: myId,
        fromName: myName,
        consultantPan: role === "taxpayer" ? pan : undefined,
        taxpayerPan: role === "consultant" ? pan : undefined,
        accessMode: mode,
        taxYears: year ? [year] : [],
        message: sanitizeText(message, 280),
      });
      onCreated(
        role === "taxpayer"
          ? "Request sent to consultant. They have 14 days to accept."
          : "Request sent to taxpayer. They will be notified to accept.",
      );
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        role === "taxpayer"
          ? "Link a chartered accountant"
          : "Request access from a taxpayer"
      }
      description={
        role === "taxpayer"
          ? "Enter the consultant's PAN, choose the access mode, and select the tax year(s). They have 14 days to accept."
          : "Enter the taxpayer's PAN. They'll be notified to accept your request and choose the access scope."
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            loading={submitting}
            leftIcon={<Icon.Link size={14} />}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label={role === "taxpayer" ? "Consultant PAN" : "Taxpayer PAN"}
          required
          error={panErr}
          htmlFor="link-pan"
          hint="Format ABCDE1234F. Searches happen only against valid PANs."
        >
          <Input
            id="link-pan"
            value={pan}
            sensitive
            placeholder="ABCDE1234F"
            onChange={(e) => setPan(sanitizePan(e.target.value))}
            invalid={Boolean(panErr)}
            maxLength={10}
            className="uppercase tabular tracking-[0.06em]"
          />
        </Field>

        <div>
          <p className="field-label">Access mode</p>
          <RadioGroup
            name="mode"
            value={mode}
            onChange={(v) => setMode(v as AccessMode)}
            options={[
              {
                value: "review_edit",
                label: "Review & edit (recommended)",
                description:
                  role === "taxpayer"
                    ? "CA edits your filing but cannot submit. You retain final authority."
                    : "You edit the filing but return it to the taxpayer to submit.",
              },
              {
                value: "full_access",
                label: "Full access",
                description:
                  role === "taxpayer"
                    ? "CA can edit AND submit on your behalf. Use when you fully delegate filings."
                    : "You can edit and submit on the taxpayer's behalf. Highest trust scope.",
              },
            ]}
          />
        </div>

        <Field label="Tax year" htmlFor="year">
          <Select
            id="year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            {TAX_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Message" htmlFor="msg" hint="Optional · max 280 characters.">
          <Input
            id="msg"
            value={message}
            placeholder={
              role === "taxpayer"
                ? "Briefly describe what you need help with"
                : "Briefly describe your offer or service"
            }
            onChange={(e) =>
              setMessage(sanitizeText(e.target.value, 280))
            }
          />
        </Field>

        {error && (
          <Alert tone="error" compact>
            {error}
          </Alert>
        )}

        <Alert tone="info" compact>
          Sending a request is auditable on both sides. The recipient sees{" "}
          {role === "taxpayer" ? "your name and PAN" : "your name and ICAI"}.
          You can revoke at any time before or after acceptance.
        </Alert>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Grant detail modal                                                        */
/* -------------------------------------------------------------------------- */

function GrantDetailModal({
  grant,
  onClose,
}: {
  grant: LinkGrant | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(grant)}
      onClose={onClose}
      title="Grant details"
      description="A full record of this access grant — visible to both parties."
      size="lg"
      footer={
        <Button onClick={onClose}>Close</Button>
      }
    >
      {grant && (
        <div className="grid gap-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Consultant" value={grant.consultantName} />
            <Detail
              label="Firm"
              value={grant.consultantFirm ?? "Independent practice"}
            />
            <Detail label="Taxpayer" value={grant.taxpayerName} />
            <Detail
              label="Taxpayer PAN"
              value={<span className="tabular">{grant.taxpayerPanMasked}</span>}
            />
            <Detail label="Access mode" value={MODE_META[grant.accessMode].label} />
            <Detail
              label="Status"
              value={
                <Badge tone={STATUS_META[grant.status].tone} size="sm" withDot>
                  {STATUS_META[grant.status].label}
                </Badge>
              }
            />
            <Detail label="Tax years" value={grant.taxYears.join(", ")} />
            <Detail
              label="Initiated by"
              value={<span className="capitalize">{grant.requestedBy}</span>}
            />
            <Detail
              label="Requested"
              value={formatDate(grant.requestedAt)}
            />
            <Detail
              label="Responded"
              value={grant.respondedAt ? formatDate(grant.respondedAt) : "—"}
            />
            <Detail
              label="Expires"
              value={grant.expiresAt ? formatDate(grant.expiresAt) : "—"}
            />
            <Detail
              label="Revoked"
              value={grant.revokedAt ? formatDate(grant.revokedAt) : "—"}
            />
          </dl>
          {grant.message && (
            <div className="rounded-lg border border-line bg-surface-sunken/50 p-3">
              <p className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                Message
              </p>
              <p className="mt-1 text-sm text-ink text-pretty">{grant.message}</p>
            </div>
          )}
          <Alert tone="neutral" compact>
            Both parties can view this grant in their audit trail. Status
            transitions and timestamps cannot be edited after the fact.
          </Alert>
        </div>
      )}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}
