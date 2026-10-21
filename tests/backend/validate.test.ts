import { describe, expect, it } from "vitest";
import {
  connectionInput,
  filter,
  integer,
  name,
  plainSql,
  rowValues,
} from "../../src/backend/validate";

const base = {
  name: "app",
  engine: "mysql",
  address: "127.0.0.1",
  port: 3306,
  username: "root",
  password: "secret",
  database: "shop",
  runAs: "",
  readOnly: false,
};

describe("connectionInput", () => {
  it("accepts a normal login", () => {
    expect(connectionInput(base)).toMatchObject({
      engine: "mysql",
      port: 3306,
      address: "127.0.0.1",
    });
  });

  it("needs a name and a known type", () => {
    expect(() => connectionInput({ ...base, name: " " })).toThrow();
    expect(() => connectionInput({ ...base, engine: "mongo" })).toThrow();
  });

  it("checks the address, port and run as user", () => {
    expect(() => connectionInput({ ...base, address: "a b;c" })).toThrow();
    expect(() => connectionInput({ ...base, port: 70000 })).toThrow();
    expect(() => connectionInput({ ...base, runAs: "Bob; id" })).toThrow();
    expect(connectionInput({ ...base, runAs: "postgres" }).runAs).toBe(
      "postgres",
    );
  });

  it("wants a full path for SQLite and drops network fields", () => {
    expect(() =>
      connectionInput({ ...base, engine: "sqlite", database: "app.db" }),
    ).toThrow();
    const input = connectionInput({
      ...base,
      engine: "sqlite",
      database: "/srv/app.db",
    });
    expect(input).toMatchObject({ address: "", port: null, password: "" });
  });
});

describe("plainSql", () => {
  it("refuses client commands", () => {
    expect(() => plainSql("postgres", "select 1\n\\! id")).toThrow();
    expect(() => plainSql("sqlite", ".shell id")).toThrow();
    expect(() => plainSql("mysql", "system id")).toThrow();
    expect(() => plainSql("mysql", "select 1 \\! id")).toThrow();
  });

  it("allows normal SQL", () => {
    expect(plainSql("postgres", " select 1 ")).toBe("select 1");
    expect(plainSql("sqlite", "select '.x'")).toBe("select '.x'");
  });

  it("needs some text", () => {
    expect(() => plainSql("mysql", "  ")).toThrow();
  });
});

describe("filter", () => {
  it("allows one condition", () => {
    expect(filter("id > 3 AND name = 'a'")).toBe("id > 3 AND name = 'a'");
    expect(filter("")).toBe("");
  });

  it("refuses a second statement", () => {
    expect(() => filter("1=1; drop table x")).toThrow();
  });
});

describe("values", () => {
  it("accepts text and null only", () => {
    expect(rowValues({ a: "1", b: null }, "v")).toEqual({ a: "1", b: null });
    expect(() => rowValues({ a: 1 }, "v")).toThrow();
    expect(() => rowValues([], "v")).toThrow();
  });

  it("checks names and numbers", () => {
    expect(() => name("a\nb", "n")).toThrow();
    expect(integer("5", "n", 1, 10, 3)).toBe(5);
    expect(integer(undefined, "n", 1, 10, 3)).toBe(3);
    expect(() => integer("99", "n", 1, 10, 3)).toThrow();
  });
});
