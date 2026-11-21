import { describe, expect, it } from "vitest";
import { routineScript } from "../../src/frontend/Browser";
import {
  appendSql,
  scriptName,
  uniqueName,
} from "../../src/frontend/SqlConsole";

describe("scriptName", () => {
  it("names a script by its first line", () => {
    expect(scriptName("-- daily orders\nSELECT * FROM orders")).toBe(
      "daily orders",
    );
    expect(scriptName("SELECT 1")).toBe("SELECT 1");
    expect(scriptName("   ")).toBe("SQL");
  });
});

describe("console helpers", () => {
  it("numbers a taken script name", () => {
    expect(uniqueName("daily", [])).toBe("daily");
    expect(uniqueName("daily", ["daily", "daily (2)"])).toBe("daily (3)");
  });

  it("adds a table name after the text with a space", () => {
    expect(appendSql("", "users")).toBe("users");
    expect(appendSql("SELECT * FROM", "users")).toBe("SELECT * FROM users");
    expect(appendSql("SELECT * FROM ", "users")).toBe("SELECT * FROM users");
  });
});

describe("routine scripts", () => {
  const routine = {
    schema: "app",
    name: "tidy",
    kind: "procedure" as const,
    definition: null,
  };

  it("wraps a MySQL routine in DROP and a delimiter", () => {
    const script = routineScript(
      "mysql",
      routine,
      "CREATE PROCEDURE `tidy`() BEGIN SELECT 1; END",
    );
    expect(script).toBe(
      "DROP PROCEDURE IF EXISTS `tidy`;\nDELIMITER //\nCREATE PROCEDURE `tidy`() BEGIN SELECT 1; END//\nDELIMITER ;\n",
    );
  });

  it("keeps a Postgres definition as it is", () => {
    expect(routineScript("postgres", routine, "CREATE OR REPLACE x")).toBe(
      "CREATE OR REPLACE x",
    );
  });
});
