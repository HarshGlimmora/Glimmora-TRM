"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { sanitizeDigits } from "@/lib/security/sanitize";

/**
 * Six-cell OTP input.
 *
 * Each cell is `maxLength={1}` so typing always moves to the next cell, and
 * paste / autofill is captured by `onPaste` and distributed across all cells.
 * Focus is moved on the next animation frame so React's render has flushed
 * the new value before we steal focus — that's what fixes the "all six
 * digits land in one box" race condition.
 */

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onComplete?: (v: string) => void;
  label?: string;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  invalid,
  disabled,
  autoFocus,
  onComplete,
  label,
}: OtpInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const lastCompleteRef = React.useRef<string>("");

  const sanitized = sanitizeDigits(value, length);
  const digits = React.useMemo(
    () => Array.from({ length }, (_, i) => sanitized[i] ?? ""),
    [sanitized, length],
  );

  // Mount auto-focus
  React.useEffect(() => {
    if (autoFocus && !disabled) {
      refs.current[0]?.focus();
    }
  }, [autoFocus, disabled]);

  // Auto-submit when the input is full (fire once per fresh value)
  React.useEffect(() => {
    if (sanitized.length < length) {
      lastCompleteRef.current = "";
      return;
    }
    if (sanitized === lastCompleteRef.current) return;
    lastCompleteRef.current = sanitized;
    onComplete?.(sanitized);
  }, [sanitized, length, onComplete]);

  /** Defer focus so React's re-render commits before we move focus. */
  const focusBox = (rawIdx: number) => {
    const idx = Math.max(0, Math.min(length - 1, rawIdx));
    requestAnimationFrame(() => {
      const el = refs.current[idx];
      if (!el) return;
      el.focus();
      try {
        el.select();
      } catch {
        /* some browsers throw on select() for short inputs */
      }
    });
  };

  const writeValue = (next: string) => {
    onChange(sanitizeDigits(next, length));
  };

  const setDigitAt = (idx: number, ch: string) => {
    const arr = digits.slice();
    arr[idx] = ch.slice(0, 1);
    writeValue(arr.join(""));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    idx: number,
  ) => {
    const incoming = sanitizeDigits(e.target.value, length);

    // Cleared
    if (incoming.length === 0) {
      setDigitAt(idx, "");
      return;
    }

    // Most common: a single digit typed into an empty cell
    if (incoming.length === 1) {
      setDigitAt(idx, incoming);
      if (idx < length - 1) focusBox(idx + 1);
      return;
    }

    // Multi-char arrival: autofill, paste-through-onChange, or "two keystrokes
    // before the first re-render". Distribute from this cell onward.
    const arr = digits.slice();
    let cursor = idx;
    for (const ch of incoming) {
      if (cursor >= length) break;
      arr[cursor] = ch;
      cursor++;
    }
    writeValue(arr.join(""));
    focusBox(Math.min(cursor, length - 1));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
  ) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[idx]) {
        setDigitAt(idx, "");
      } else if (idx > 0) {
        setDigitAt(idx - 1, "");
        focusBox(idx - 1);
      }
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      setDigitAt(idx, "");
      return;
    }
    if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      focusBox(idx - 1);
      return;
    }
    if (e.key === "ArrowRight" && idx < length - 1) {
      e.preventDefault();
      focusBox(idx + 1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusBox(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusBox(length - 1);
      return;
    }
    // Allow Enter to bubble to the surrounding form for submission.
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = sanitizeDigits(e.clipboardData.getData("text"), length);
    if (!pasted) return;
    writeValue(pasted);
    focusBox(Math.min(pasted.length, length - 1));
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Make over-typing intuitive: focusing a filled cell selects it.
    try {
      e.target.select();
    } catch {
      /* noop */
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label className="field-label">
          {label}
          <span className="ml-auto text-2xs font-normal tracking-normal normal-case text-ink-subtle">
            6-digit code
          </span>
        </label>
      )}
      <div
        role="group"
        aria-label={label ?? "One time passcode"}
        className="flex items-center gap-2"
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            // Per-cell limit of 1 — paste is handled separately.
            maxLength={1}
            disabled={disabled}
            value={d}
            onChange={(e) => handleChange(e, i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onPaste={handlePaste}
            onFocus={handleFocus}
            data-1p-ignore="true"
            data-lpignore="true"
            aria-invalid={invalid || undefined}
            aria-label={`Digit ${i + 1} of ${length}`}
            className={cn(
              "tabular h-12 w-11 rounded-lg border bg-surface-raised text-center text-lg font-medium text-ink shadow-sm transition-shadow",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              invalid
                ? "border-signal-error/60 focus-visible:ring-signal-error/40"
                : "border-line-strong focus-visible:border-accent focus-visible:ring-accent/40",
              d && "border-accent/40 bg-accent-soft/30",
              disabled && "opacity-60",
            )}
          />
        ))}
      </div>
    </div>
  );
}
