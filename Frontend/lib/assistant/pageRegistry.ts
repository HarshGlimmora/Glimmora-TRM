/**
 * Resolves the current pathname into a stable assistant page id so the
 * backend can scope answers to the right screen. Also flags screens where
 * the assistant must stay hidden (auth, onboarding, OTP verify, submit).
 *
 * Keep these ids in sync with `Backend/app/chatbot/knowledge.py::PAGES`.
 */

export type AssistantPageId =
  | "dashboard"
  | "connections"
  | "filings_new"
  | "filing_documents"
  | "filing_transactions"
  | "filing_regime"
  | "filing_summary"
  | "filing_submit"
  | "auth_login"
  | "auth_verify"
  | "auth_role"
  | "onboarding"
  | "unknown";

export interface PageContext {
  id: AssistantPageId;
  label: string;
  section: string;
  /** True when the assistant must be hidden (auth, onboarding, payment). */
  suppressed: boolean;
}

interface Rule {
  test: RegExp;
  id: AssistantPageId;
  label: string;
  section: string;
  suppressed?: boolean;
}

// Order matters — first match wins. Most specific patterns first.
const RULES: Rule[] = [
  // Auth / onboarding — sensitive identity entry, assistant suppressed.
  { test: /^\/login(\/|$)/,      id: "auth_login",  label: "Sign in",          section: "Sign in",     suppressed: true },
  { test: /^\/verify(\/|$)/,     id: "auth_verify", label: "Verify identity",  section: "Sign in",     suppressed: true },
  { test: /^\/role-select(\/|$)/,id: "auth_role",   label: "Choose role",      section: "Sign in",     suppressed: true },
  { test: /^\/onboarding(\/|$)/, id: "onboarding",  label: "Set up your profile", section: "Onboarding", suppressed: true },

  // Filing sub-screens (must come before the bare /filings rule).
  { test: /^\/filings\/[^/]+\/documents(\/|$)/,    id: "filing_documents",    label: "Documents",    section: "Filing" },
  { test: /^\/filings\/[^/]+\/transactions(\/|$)/, id: "filing_transactions", label: "Transactions", section: "Filing" },
  { test: /^\/filings\/[^/]+\/regime(\/|$)/,       id: "filing_regime",       label: "Regime",       section: "Filing" },
  { test: /^\/filings\/[^/]+\/summary(\/|$)/,      id: "filing_summary",      label: "Summary",      section: "Filing" },
  // Submit is sensitive (OTP + locking). Always suppress.
  { test: /^\/filings\/[^/]+\/submit(\/|$)/,       id: "filing_submit",       label: "Submit",       section: "Filing", suppressed: true },
  { test: /^\/filings\/new(\/|$)/,                 id: "filings_new",         label: "Start a filing", section: "Filings" },

  // Top-level app routes.
  { test: /^\/dashboard(\/|$)/,   id: "dashboard",   label: "Overview",   section: "Dashboard" },
  { test: /^\/connections(\/|$)/, id: "connections", label: "Connections", section: "Connections" },
];

const UNKNOWN: PageContext = {
  id: "unknown",
  label: "Glimmora Tax",
  section: "Glimmora Tax",
  suppressed: false,
};

export function resolvePageContext(pathname: string | null | undefined): PageContext {
  if (!pathname) return UNKNOWN;
  for (const rule of RULES) {
    if (rule.test.test(pathname)) {
      return {
        id: rule.id,
        label: rule.label,
        section: rule.section,
        suppressed: !!rule.suppressed,
      };
    }
  }
  return UNKNOWN;
}
