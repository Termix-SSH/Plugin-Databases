import { describe, expect, it } from "vitest";
import { routineScript } from "../../src/frontend/Browser";
import { idOf, pretty } from "../../src/frontend/MongoBrowser";
import { ttlText } from "../../src/frontend/RedisBrowser";

describe("Redis and MongoDB view helpers", () => {
  it("writes a TTL as days, hours and minutes", () => {
    expect(ttlText(-1)).toBe("");
    expect(ttlText(45_000)).toBe("45s");
    expect(ttlText(3_900_000)).toBe("1h 5m");
    expect(ttlText(90_000_000)).toBe("1d 1h");
  });

  it("pretty prints documents and finds their _id", () => {
    expect(pretty('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(pretty("not json")).toBe("not json");
    expect(idOf('{"_id":{"$oid":"abc"},"a":1}')).toBe('{"$oid":"abc"}');
    expect(idOf('{"a":1}')).toBeNull();
  });
});

describe("routineScript for SQL Server", () => {
  it("turns CREATE into CREATE OR ALTER", () => {
    const routine = {
      schema: "dbo",
      name: "hello",
      kind: "procedure" as const,
      definition: null,
    };
    expect(
      routineScript(
        "mssql",
        routine,
        "-- note\nCREATE PROCEDURE dbo.hello AS SELECT 1",
      ),
    ).toBe("-- note\nCREATE OR ALTER PROCEDURE dbo.hello AS SELECT 1");
    expect(routineScript("mssql", routine, "create function f()")).toBe(
      "CREATE OR ALTER function f()",
    );
  });
});
