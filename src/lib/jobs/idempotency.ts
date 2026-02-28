import crypto from "node:crypto";

export function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

export function stableStringify(value: unknown) {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}
