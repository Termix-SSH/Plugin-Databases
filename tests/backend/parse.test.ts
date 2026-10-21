import { describe, expect, it } from "vitest";
import {
  NULL_MARK,
  parseCsv,
  parseTsv,
  sections,
  SECTION_MARK,
} from "../../src/backend/engines/parse";

describe("parseCsv", () => {
  it("reads a header and rows", () => {
    expect(parseCsv("id,name\n1,al\n2,bo\n")).toEqual({
      columns: ["id", "name"],
      rows: [
        ["1", "al"],
        ["2", "bo"],
      ],
    });
  });

  it("reads quotes, commas and new lines inside fields", () => {
    const grid = parseCsv('a,b\n"x,1","line\none ""q"""\n');
    expect(grid.rows).toEqual([["x,1", 'line\none "q"']]);
  });

  it("handles CRLF rows", () => {
    expect(parseCsv("a\r\n1\r\n2\r\n").rows).toEqual([["1"], ["2"]]);
  });

  it("tells NULL from an empty value", () => {
    const grid = parseCsv(`a,b\n${NULL_MARK},\n`);
    expect(grid.rows).toEqual([[null, ""]]);
  });

  it("returns nothing for no output", () => {
    expect(parseCsv("")).toEqual({ columns: [], rows: [] });
  });
});

describe("parseTsv", () => {
  it("reads rows and unescapes", () => {
    const grid = parseTsv("id\tnote\n1\ta\\tb\\nc\\\\d\n");
    expect(grid.columns).toEqual(["id", "note"]);
    expect(grid.rows).toEqual([["1", "a\tb\nc\\d"]]);
  });

  it("maps NULL to null", () => {
    expect(parseTsv("a\nNULL\n").rows).toEqual([[null]]);
  });
});

describe("sections", () => {
  it("splits on the marker line", () => {
    expect(sections(`a\n${SECTION_MARK}\nb\n`)).toEqual(["a\n", "b\n"]);
  });
});
