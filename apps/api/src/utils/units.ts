import type { Units } from "@cutting/contracts";

export function toMillimeters(value: number, units: Units): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  switch (units) {
    case "mm":
      return Math.round(value);
    case "cm":
      return Math.round(value * 10);
    case "m":
      return Math.round(value * 1000);
    default:
      return 0;
  }
}

