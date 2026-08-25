import { describe, it, expect } from "vitest";
import { detectFileType } from "../src/services/importerService.js";

describe("detectFileType", () => {
  it("detects type from a known file extension", () => {
    expect(detectFileType("tenants.csv", "text/csv")).toBe("csv");
    expect(detectFileType("lease.pdf", "application/pdf")).toBe("pdf");
    expect(detectFileType("rent-roll.xlsx", "application/vnd.openxmlformats")).toBe("xlsx");
    expect(detectFileType("lease.docx", "application/msword")).toBe("docx");
    expect(detectFileType("screenshot.PNG", "image/png")).toBe("png");
  });

  it("falls back to mimetype when the extension is missing/ambiguous", () => {
    expect(detectFileType("export", "text/csv")).toBe("csv");
    expect(detectFileType("scan", "image/jpeg")).toBe("jpg");
  });

  it("throws a clear error for a genuinely unsupported file", () => {
    expect(() => detectFileType("archive.zip", "application/zip")).toThrow(/Unsupported file type/);
  });
});
