import { describe, expect, it } from "vitest";
import {
  isReadStatement,
  resultStatements,
  splitStatements,
} from "../../src/backend/split-sql.js";

describe("splitting SQL", () => {
  it("splits on semicolons outside quotes and comments", () => {
    expect(
      splitStatements(
        "SELECT 'a;b' FROM t; -- x;y\nSELECT \"c;d\" /* ; */ FROM u;",
        "postgres",
      ),
    ).toEqual(["SELECT 'a;b' FROM t", '-- x;y\nSELECT "c;d" /* ; */ FROM u']);
  });

  it("knows MySQL backticks, escapes and hash comments", () => {
    expect(
      splitStatements(
        "SELECT `a;b`, 'it\\'s;' FROM t # c;\n; SHOW TABLES",
        "mysql",
      ),
    ).toEqual(["SELECT `a;b`, 'it\\'s;' FROM t # c;", "SHOW TABLES"]);
  });

  it("keeps Postgres dollar quoted bodies whole", () => {
    expect(
      splitStatements("SELECT $$a;b$$; SELECT $x$c;$x$", "postgres"),
    ).toEqual(["SELECT $$a;b$$", "SELECT $x$c;$x$"]);
  });

  it("does not split blocks or DELIMITER scripts", () => {
    expect(
      splitStatements("CREATE PROCEDURE p() BEGIN SELECT 1; END", "mysql"),
    ).toHaveLength(1);
    expect(
      splitStatements("DELIMITER //\nSELECT 1//\nDELIMITER ;", "mysql"),
    ).toHaveLength(1);
  });

  it("only splits when every statement reads", () => {
    expect(isReadStatement("/* hi */ -- x\n select 1")).toBe(true);
    expect(isReadStatement("UPDATE t SET a = 1")).toBe(false);
    expect(
      resultStatements("SELECT * FROM a; SELECT * FROM b;", "mysql"),
    ).toEqual(["SELECT * FROM a", "SELECT * FROM b"]);
    expect(resultStatements("SET @x = 1; SELECT @x", "mysql")).toBeNull();
    expect(resultStatements("SELECT 1", "mysql")).toBeNull();
  });
});
