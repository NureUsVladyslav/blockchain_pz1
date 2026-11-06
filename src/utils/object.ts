// Звичайний об'єкт: не null, не масив, не рядок і не число
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// У об'єкта рівно такі поля
export function hasExactKeys(
  obj: Record<string, unknown>,
  expected: string[],
): boolean {
  return Object.keys(obj).sort().join(",") === [...expected].sort().join(",");
}
