export function isNonEmptyString(str?: unknown): str is string {
  if (!str) return false;
  return typeof str === "string" && str.trim() !== "";
}

export function isNull(value?: unknown): value is null {
  if (typeof value === "undefined") return false;
  return typeof value === "object" && value === null;
}
