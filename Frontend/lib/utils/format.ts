export function formatRelative(date: Date | string | number): string {
  const d = new Date(date);
  const now = Date.now();
  const diff = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diff);

  const intervals: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [limit, unit] of intervals) {
    if (abs < limit) {
      const divisor =
        unit === "second"
          ? 1
          : unit === "minute"
            ? 60
            : unit === "hour"
              ? 3600
              : unit === "day"
                ? 86400
                : unit === "week"
                  ? 604800
                  : unit === "month"
                    ? 2629800
                    : 31557600;
      return rtf.format(Math.round(diff / divisor), unit);
    }
  }
  return d.toLocaleDateString();
}

export function formatDate(date: Date | string | number): string {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateLong(date: Date | string | number): string {
  return new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string | number): string {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name: string, max = 2): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural ?? `${singular}s`);
}
