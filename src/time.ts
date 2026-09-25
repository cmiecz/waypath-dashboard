const TZ = "America/New_York";

export function formatEt(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    ...opts,
  }).format(d);
}

export function formatEtClock(iso: string | Date): string {
  return formatEt(iso, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

export function formatEtDateTime(iso: string | Date): string {
  return (
    formatEt(iso, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " ET"
  );
}

export function relativeTime(iso: string | Date, now = Date.now()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = now - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? "" : "s"} ago`;
  return formatEtDateTime(d);
}

export function durationInStage(iso: string | Date | null, now = Date.now()): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Math.max(0, now - d.getTime());
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  if (hr < 48) return rem ? `${hr}h ${rem}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}
