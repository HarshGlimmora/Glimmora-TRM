"use client";

import * as React from "react";
import { AssistantFab } from "@/components/assistant/AssistantFab";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { usePageContext } from "@/components/assistant/usePageContext";

/**
 * Orchestrator for the floating in-product assistant.
 *
 * Lives at the bottom-right of every authenticated screen, except those
 * the page registry marks as `suppressed` (auth, OTP verify, onboarding
 * with PAN/Aadhaar entry, and the filing submit step). On suppressed
 * screens the FAB is hidden via opacity — the component stays mounted
 * so that returning to an allowed screen does NOT replay the entrance
 * animation, which previously made the button appear to "flash" during
 * route transitions.
 */
export function Assistant() {
  const page = usePageContext();
  const [open, setOpen] = React.useState(false);

  // If the user opened the panel and then navigated to a sensitive screen,
  // tear it down rather than leaving a stale chat open over PAN entry.
  React.useEffect(() => {
    if (page.suppressed && open) setOpen(false);
  }, [page.suppressed, open]);

  const allowed = !page.suppressed;

  return (
    <>
      <AssistantFab onOpen={() => setOpen(true)} visible={allowed && !open} />
      {allowed && (
        <AssistantPanel
          open={open}
          page={page}
          onMinimize={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
