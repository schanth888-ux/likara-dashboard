/**
 * Minimal, dependency-free CSV serializer. Deliberately not using a library
 * for this — the escaping rules are simple and a pure function is easy to
 * unit test (see api/tests/csvExport.test.js).
 * @param {object[]} rows
 * @returns {string}
 */
export function arrayToCsv(rows) {
  if (!rows || rows.length === 0) return "";

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row ?? {}).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );

  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const str = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(escape).join(",");
  const lines = rows.map((row) => columns.map((col) => escape(row[col])).join(","));
  return [header, ...lines].join("\n");
}
