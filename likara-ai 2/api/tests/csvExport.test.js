import { describe, it, expect } from "vitest";
import { arrayToCsv } from "../src/lib/csvExport.js";

describe("arrayToCsv", () => {
  it("returns an empty string for no rows", () => {
    expect(arrayToCsv([])).toBe("");
    expect(arrayToCsv(null)).toBe("");
  });

  it("writes a header row from the union of all row keys", () => {
    const csv = arrayToCsv([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
    const [header] = csv.split("\n");
    expect(header.split(",").sort()).toEqual(["a", "b", "c"].sort());
  });

  it("escapes values containing commas, quotes, or newlines", () => {
    const csv = arrayToCsv([{ name: 'Chan, "Tai" Man\nJr.' }]);
    expect(csv).toContain('"Chan, ""Tai"" Man\nJr."');
  });

  it("renders null/undefined as an empty cell, not the string 'null'", () => {
    const csv = arrayToCsv([{ name: "Wong", phone: null }]);
    const lines = csv.split("\n");
    expect(lines[1]).not.toContain("null");
  });

  it("serializes nested objects as JSON rather than [object Object]", () => {
    const csv = arrayToCsv([{ meta: { unit: "12A" } }]);
    expect(csv).toContain('"{""unit"":""12A""}"');
  });
});
