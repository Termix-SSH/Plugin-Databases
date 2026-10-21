import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasBash, hasSqlite, startServer, type TestServer } from "./helpers";

// Runs the generated scripts in a local bash against a real SQLite file.
let server: TestServer | null = null;
let dir = "";
let file = "";
let id = 0;

/** The path the way bash sees it. */
function posix(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
}

const ready = hasBash && hasSqlite;

beforeEach(async () => {
  if (!ready) return;
  dir = mkdtempSync(join(tmpdir(), "databases-"));
  const path = join(dir, "app.db");
  file = posix(path);
  const seed = spawnSync("sqlite3", [path], {
    input: [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, note TEXT);",
      "INSERT INTO users (name, note) VALUES ('ann', 'first'), ('bob', NULL);",
      "CREATE TABLE log (msg TEXT);",
      "CREATE VIEW names AS SELECT name FROM users;",
      "CREATE INDEX users_name ON users (name);",
    ].join("\n"),
    encoding: "utf8",
  });
  expect(seed.status).toBe(0);
  server = await startServer({ local: true });
  const res = await server.request("POST", "/1/connections", {
    name: "local",
    engine: "sqlite",
    database: file,
  });
  expect(res.status).toBe(200);
  id = res.body.id;
});

afterEach(async () => {
  await server?.close();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

const base = () => `/1/connections/${id}`;

describe.skipIf(!ready)("sqlite on a local shell", () => {
  it("tests the login and lists tables", async () => {
    const s = server!;
    const test = await s.request("POST", "/1/connections/test", {
      name: "x",
      engine: "sqlite",
      database: file,
    });
    expect(test.body.version).toMatch(/^3\./);
    expect((await s.request("GET", `${base()}/databases`)).body).toEqual([
      "main",
    ]);
    const tables = await s.request("GET", `${base()}/tables?db=main`);
    expect(tables.body.map((t: { name: string }) => t.name)).toEqual([
      "log",
      "names",
      "users",
    ]);
    expect(
      tables.body.find((t: { name: string }) => t.name === "names").kind,
    ).toBe("view");
  });

  it("describes columns and indexes", async () => {
    const res = await server!.request(
      "GET",
      `${base()}/describe?db=main&table=users`,
    );
    expect(res.body.columns).toMatchObject([
      { name: "id", primary: true, editable: true },
      { name: "name", nullable: false, primary: false },
      { name: "note", nullable: true },
    ]);
    expect(res.body.indexes.map((i: { name: string }) => i.name)).toContain(
      "users_name",
    );
  });

  it("pages, sorts and filters, and keeps NULL apart from empty", async () => {
    const res = await server!.request("POST", `${base()}/rows`, {
      db: "main",
      table: "users",
      orderBy: "name",
      dir: "desc",
      where: "id > 0",
    });
    expect(res.body.total).toBe(2);
    expect(res.body.grid.columns).toEqual(["id", "name", "note"]);
    expect(res.body.grid.rows).toEqual([
      ["2", "bob", null],
      ["1", "ann", "first"],
    ]);
    const filtered = await server!.request("POST", `${base()}/rows`, {
      db: "main",
      table: "users",
      where: "name = 'ann'",
    });
    expect(filtered.body.total).toBe(1);
  });

  it("inserts, updates and deletes with awkward text", async () => {
    const s = server!;
    const awkward = `O'Brien; "quoted" \`tick\` $HOME \\n line\nnext é 日本`;
    const added = await s.request("POST", `${base()}/row`, {
      db: "main",
      table: "users",
      values: { name: awkward, note: null },
    });
    expect(added.body).toEqual({ affected: 1 });

    let rows = await s.request("POST", `${base()}/rows`, {
      db: "main",
      table: "users",
      where: "id = 3",
    });
    expect(rows.body.grid.rows).toEqual([["3", awkward, null]]);

    const changed = await s.request("PUT", `${base()}/row`, {
      db: "main",
      table: "users",
      key: { id: "3" },
      values: { note: "'; DROP TABLE users; --" },
    });
    expect(changed.body).toEqual({ affected: 1 });
    rows = await s.request("POST", `${base()}/rows`, {
      db: "main",
      table: "users",
      where: "id = 3",
    });
    expect(rows.body.grid.rows[0][2]).toBe("'; DROP TABLE users; --");
    expect(rows.body.total).toBe(1);

    const removed = await s.request("POST", `${base()}/row/delete`, {
      db: "main",
      table: "users",
      key: { id: "3" },
    });
    expect(removed.body).toEqual({ affected: 1 });
    const left = await s.request("POST", `${base()}/rows`, {
      db: "main",
      table: "users",
    });
    expect(left.body.total).toBe(2);
  });

  it("will not edit a table without a key", async () => {
    const res = await server!.request("POST", `${base()}/row/delete`, {
      db: "main",
      table: "log",
      key: {},
    });
    expect(res.status).toBe(400);
  });

  it("runs SQL and shows errors", async () => {
    const s = server!;
    const ok = await s.request("POST", `${base()}/query`, {
      db: "main",
      sql: "SELECT name, note FROM users ORDER BY id",
    });
    expect(ok.body.rows).toEqual([
      ["ann", "first"],
      ["bob", null],
    ]);
    const write = await s.request("POST", `${base()}/query`, {
      db: "main",
      sql: "INSERT INTO log (msg) VALUES ('hi')",
    });
    expect(write.status).toBe(200);
    expect(write.body.columns).toEqual([]);
    const bad = await s.request("POST", `${base()}/query`, {
      db: "main",
      sql: "SELECT * FROM nothing",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("no such table");
  });

  it("cannot write in a read only session", async () => {
    const s = server!;
    s.setLevel("connect");
    const res = await s.request("POST", `${base()}/query`, {
      db: "main",
      sql: "INSERT INTO log (msg) VALUES ('no')",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.toLowerCase()).toContain("readonly");
    s.setLevel("manage");
    const count = await s.request("POST", `${base()}/query`, {
      db: "main",
      sql: "SELECT COUNT(*) FROM log",
    });
    expect(count.body.rows).toEqual([["0"]]);
  });

  it("reports a missing file", async () => {
    const s = server!;
    const res = await s.request("POST", "/1/connections/test", {
      name: "x",
      engine: "sqlite",
      database: `${file}.missing`,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not found");
  });
});
