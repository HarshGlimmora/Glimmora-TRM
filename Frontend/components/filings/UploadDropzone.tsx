"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/Button";
import {
  ACCEPTED_EXTENSIONS,
  uploadDocument,
  type DocumentDTO,
} from "@/lib/api/documents";

/**
 * Multi-file drag/drop dropzone. Streams each file through
 * POST /api/documents/upload with per-file progress reporting. Calls
 * `onUploaded(doc)` after each successful upload so the parent can refetch
 * the documents list.
 */

interface QueueItem {
  id: string;       // synthetic per-upload id (not the server doc id)
  file: File;
  progress: number; // 0..1
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  result?: DocumentDTO;
}

export function UploadDropzone({
  onUploaded,
  disabled,
}: {
  onUploaded: (doc: DocumentDTO) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [queue, setQueue] = React.useState<QueueItem[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const items: QueueItem[] = Array.from(files).map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        progress: 0,
        status: "queued",
      }));
      if (!items.length) return;
      setQueue((q) => [...items, ...q]);

      // Sequential upload — keeps backend / network load predictable and the
      // UX simple. Parallelism can be added in a later step if needed.
      for (const item of items) {
        setQueue((q) =>
          q.map((it) => (it.id === item.id ? { ...it, status: "uploading" } : it)),
        );
        try {
          const doc = await uploadDocument({
            file: item.file,
            onProgress: (loaded, total) => {
              setQueue((q) =>
                q.map((it) =>
                  it.id === item.id ? { ...it, progress: total ? loaded / total : 0 } : it,
                ),
              );
            },
          });
          // Backend now always returns a 2xx with a DocumentDTO — even when
          // parsing fails — and surfaces the reason via doc.status='failed' +
          // the notes in routing_report. Reflect that in the queue.
          const failedNote = doc.status === "failed"
            ? (doc.routing_report?.notes?.[0] ?? "Saved but could not process.")
            : null;
          setQueue((q) =>
            q.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: failedNote ? "error" : "done",
                    progress: 1,
                    result: doc,
                    error: failedNote ?? undefined,
                  }
                : it,
            ),
          );
          onUploaded(doc);
        } catch (e) {
          setQueue((q) =>
            q.map((it) =>
              it.id === item.id
                ? {
                    ...it,
                    status: "error",
                    error:
                      e instanceof Error ? e.message : "Upload failed unexpectedly.",
                  }
                : it,
            ),
          );
        }
      }
    },
    [onUploaded],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };
  const onDragLeave = () => setDragging(false);

  const clearDone = () =>
    setQueue((q) => q.filter((it) => it.status !== "done"));

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "relative rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-navy bg-navy/5"
            : "border-line bg-surface-sunken hover:border-navy/40",
          disabled && "pointer-events-none opacity-60",
        )}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <p className="text-sm font-medium text-ink">
          Drop Form 16, Form 26AS, AIS / TIS, salary slips, or bank statements here
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          PDF and CSV up to 10 MB each. Type and FY are auto-detected.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="mt-4"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          Choose files
        </Button>
      </div>

      {queue.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-raised px-4 py-3">
          {queue.map((it) => (
            <li key={it.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {it.file.name}
              </span>
              {it.status === "uploading" && (
                <span className="text-xs text-ink-muted">
                  {Math.round(it.progress * 100)}%
                </span>
              )}
              {it.status === "done" && (
                <span className="text-xs font-medium text-signal-success">
                  Uploaded
                </span>
              )}
              {it.status === "error" && (
                <span className="text-xs text-signal-error" title={it.error}>
                  {it.error ?? "Upload failed"}
                </span>
              )}
              {it.status === "queued" && (
                <span className="text-xs text-ink-muted">Queued…</span>
              )}
            </li>
          ))}
          {queue.some((it) => it.status === "done") && (
            <li className="mt-1.5">
              <button
                onClick={clearDone}
                className="text-xs text-ink-muted underline"
              >
                Clear completed
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
