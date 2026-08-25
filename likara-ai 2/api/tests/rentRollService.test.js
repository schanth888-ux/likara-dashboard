import { describe, it, expect } from "vitest";
import { clampDueDate } from "../src/services/rentRollService.js";

describe("clampDueDate", () => {
  it("uses the due day as-is when it fits in the month", () => {
    expect(clampDueDate("2026-08", 5)).toBe("2026-08-05");
  });

  it("clamps due_day=31 to the last real day of a 30-day month", () => {
    expect(clampDueDate("2026-04", 31)).toBe("2026-04-30");
  });

  it("clamps due_day=31 to 28 in a non-leap February", () => {
    expect(clampDueDate("2026-02", 31)).toBe("2026-02-28");
  });

  it("clamps due_day=31 to 29 in a leap February", () => {
    expect(clampDueDate("2028-02", 31)).toBe("2028-02-29");
  });

  it("pads single-digit days with a leading zero", () => {
    expect(clampDueDate("2026-01", 1)).toBe("2026-01-01");
  });
});
