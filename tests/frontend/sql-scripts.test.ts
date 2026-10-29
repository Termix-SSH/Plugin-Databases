import { describe, expect, it } from "vitest";
import { scriptName } from "../../src/frontend/SqlConsole";

describe("scriptName", () => {
  it("names a script by its first line", () => {
    expect(scriptName("-- daily orders\nSELECT * FROM orders")).toBe(
      "daily orders",
    );
    expect(scriptName("SELECT 1")).toBe("SELECT 1");
    expect(scriptName("   ")).toBe("SQL");
  });
});
