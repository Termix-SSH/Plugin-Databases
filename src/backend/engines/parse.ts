import type { Grid } from "../../shared/types.js";

/** Printed by the clients in place of NULL, so it differs from empty text. */
export const NULL_MARK = "\u0001N\u0001";

function cell(value: string): string | null {
  return value === NULL_MARK ? null : value;
}

function toGrid(table: string[][]): Grid {
  if (table.length === 0) return { columns: [], rows: [] };
  const [columns, ...rows] = table;
  return { columns, rows: rows.map((row) => row.map(cell)) };
}

/** Reads CSV with quoted fields, as psql and sqlite3 print it. */
export function parseCsv(input: string): Grid {
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      table.push(row);
      row = [];
      field = "";
      started = false;
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field || row.length) {
    row.push(field);
    table.push(row);
  }
  return toGrid(table);
}

const TSV_ESCAPES: Record<string, string> = {
  t: "\t",
  n: "\n",
  r: "\r",
  "0": "\u0000",
  "\\": "\\",
};

function unescapeTsv(value: string): string {
  return value.replace(/\\([tnr0\\])/g, (_m, c: string) => TSV_ESCAPES[c]);
}

/** Reads mysql --batch output: tab separated, escapes for tab, newline and \. */
export function parseTsv(input: string): Grid {
  const lines = input.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const table = lines.map((line) => line.split("\t").map(unescapeTsv));
  const grid = toGrid(table);
  // mysql prints a missing value as the word NULL.
  grid.rows = grid.rows.map((row) =>
    row.map((value) => (value === "NULL" ? null : value)),
  );
  return grid;
}

/** The sections of one script run, which prints SECTION_MARK between them. */
export const SECTION_MARK = "@@DBX-7f3a@@";

export function sections(output: string): string[] {
  return output.split(`${SECTION_MARK}\n`);
}
