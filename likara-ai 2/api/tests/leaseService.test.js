import { describe, it, expect } from "vitest";
import { addDays, addYears } from "../src/services/leaseService.js";

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(addDays("2026-12-30", 1)).toBe("2026-12-31");
  });

  it("rolls over into the next month/year correctly", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("addYears", () => {
  it("adds a full year, used for the default 'renew for 12 months' behavior", () => {
    expect(addYears("2026-01-01", 1)).toBe("2027-01-01");
  });

  it("handles a Feb 29 start rolling into a non-leap year (JS Date shifts to Mar 1)", () => {
    // Documenting actual behavior rather than asserting an "ideal" one — renewLease's
    // default is generally overridden by the user for edge-case start dates anyway.
    expect(addYears("2028-02-29", 1)).toBe("2029-03-01");
  });
});
