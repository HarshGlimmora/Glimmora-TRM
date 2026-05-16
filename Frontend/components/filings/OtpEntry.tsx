"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Fires when the 6th digit is entered. Use this to auto-submit. */
  onComplete?: (otp: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** A small accessible label rendered above the boxes. */
  label?: string;
}

const SIZE = 6;

/**
 * Six-box OTP input. Mirrors the pattern users already see on bank apps:
 *
 *  - Type a digit → advance focus.
 *  - Backspace on an empty box → step back and clear the previous box.
 *  - Paste a full code anywhere → distribute across boxes and submit.
 *  - Arrow keys navigate between boxes.
 */
export function OtpEntry({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label,
}: Props) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);

  const setDigits = React.useCallback(
    (digits: string) => {
      const clean = digits.replace(/\D/g, "").slice(0, SIZE);
      onChange(clean);
      if (clean.length === SIZE) onComplete?.(clean);
    },
    [onChange, onComplete],
  );

  const handleInput = (idx: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const arr = value.padEnd(SIZE, " ").split("");
    arr[idx] = digit || " ";
    const next = arr.join("").trim();
    setDigits(next);
    if (digit && idx < SIZE - 1) {
      refs.current[idx + 1]?.focus();
      refs.current[idx + 1]?.select();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[idx] && idx > 0) {
      e.preventDefault();
      const arr = value.padEnd(SIZE, " ").split("");
      arr[idx - 1] = " ";
      setDigits(arr.join("").trim());
      refs.current[idx - 1]?.focus();
      refs.current[idx - 1]?.select();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      refs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < SIZE - 1) {
      e.preventDefault();
      refs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, SIZE);
    if (!pasted) return;
    setDigits(pasted);
    const focusIdx = Math.min(pasted.length, SIZE - 1);
    refs.current[focusIdx]?.focus();
    refs.current[focusIdx]?.select();
  };

  const inputId = React.useId();
  return (
    <div>
      {label && (
        <label
          htmlFor={`${inputId}-0`}
          className="mb-2 block text-sm font-medium text-ink"
        >
          {label}
        </label>
      )}
      <div className="flex items-center gap-2" role="group" aria-label={label ?? "OTP"}>
        {Array.from({ length: SIZE }, (_, i) => (
          <input
            key={i}
            id={`${inputId}-${i}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            value={value[i] ?? ""}
            onChange={(e) => handleInput(i, e.currentTarget.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.currentTarget.select()}
            aria-invalid={invalid || undefined}
            className={cn(
              "h-12 w-10 rounded-lg border bg-surface-raised text-center text-lg font-semibold tabular-nums",
              "focus:outline-none focus:ring-2 focus:ring-navy/30",
              invalid
                ? "border-signal-error focus:ring-signal-error/30"
                : "border-line",
              disabled && "cursor-not-allowed opacity-60",
            )}
          />
        ))}
      </div>
    </div>
  );
}
