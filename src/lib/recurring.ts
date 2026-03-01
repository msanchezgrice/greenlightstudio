const DEFAULT_INTERVAL_MINUTES = 5;

type CronShape =
  | { kind: "every_n_minutes"; minutes: number }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; minute: number; hour: number }
  | { kind: "unsupported" };

function parseCron(expr: string): CronShape {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { kind: "unsupported" };

  const [min, hour, dom, month, dow] = parts;
  if (hour === "*" && dom === "*" && month === "*" && dow === "*") {
    const intervalMatch = min.match(/^\*\/(\d{1,3})$/);
    if (intervalMatch) {
      const minutes = Number(intervalMatch[1]);
      if (Number.isFinite(minutes) && minutes > 0) {
        return { kind: "every_n_minutes", minutes };
      }
    }

    const minute = Number(min);
    if (Number.isInteger(minute) && minute >= 0 && minute <= 59) {
      return { kind: "hourly", minute };
    }
  }

  if (dom === "*" && month === "*" && dow === "*") {
    const minute = Number(min);
    const hourNumber = Number(hour);
    if (
      Number.isInteger(minute) && minute >= 0 && minute <= 59 &&
      Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23
    ) {
      return { kind: "daily", minute, hour: hourNumber };
    }
  }

  return { kind: "unsupported" };
}

export function computeNextRunAt(input: {
  cronExpr: string;
  timezone?: string | null;
  from?: Date;
}) {
  const now = new Date(input.from ?? new Date());
  now.setUTCSeconds(0, 0);
  const parsed = parseCron(input.cronExpr);

  if (parsed.kind === "every_n_minutes") {
    const next = new Date(now.getTime() + parsed.minutes * 60_000);
    return next;
  }

  if (parsed.kind === "hourly") {
    const next = new Date(now);
    next.setUTCMinutes(parsed.minute, 0, 0);
    if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  if (parsed.kind === "daily") {
    const next = new Date(now);
    next.setUTCHours(parsed.hour, parsed.minute, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  return new Date(now.getTime() + DEFAULT_INTERVAL_MINUTES * 60_000);
}

export function validateRecurringCron(expr: string) {
  return parseCron(expr).kind !== "unsupported";
}
