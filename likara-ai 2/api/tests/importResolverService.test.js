import { describe, it, expect } from "vitest";
import { normalizeHkPhone, parseAmount } from "../src/services/importResolverService.js";

describe("normalizeHkPhone", () => {
  it("returns null for empty input", () => {
    expect(normalizeHkPhone(null)).toBeNull();
    expect(normalizeHkPhone("")).toBeNull();
  });

  it("strips spaces and dashes from a plain 8-digit number", () => {
    expect(normalizeHkPhone("9123 4567")).toBe("91234567");
    expect(normalizeHkPhone("9123-4567")).toBe("91234567");
  });

  it("drops a +852 country code prefix", () => {
    expect(normalizeHkPhone("+852 9123 4567")).toBe("91234567");
    expect(normalizeHkPhone("85291234567")).toBe("91234567");
  });
});

describe("parseAmount", () => {
  it("returns null for null/undefined", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it("strips HK$ prefix and thousands separators", () => {
    expect(parseAmount("HK$18,500")).toBe(18500);
    expect(parseAmount("$18,500")).toBe(18500);
  });

  it("passes through a plain number unchanged", () => {
    expect(parseAmount(18500)).toBe(18500);
  });

  it("returns null for a value with no extractable number", () => {
    expect(parseAmount("N/A")).toBeNull();
  });
});
