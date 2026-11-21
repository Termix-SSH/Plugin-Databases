import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getEngine, type Conn } from "../../src/backend/engines/index";
import {
  mssql,
  parseJson,
  parseMssql,
  parseTable,
} from "../../src/backend/engines/mssql";
import {
  collectionName,
  consoleScript,
  dbName,
  ejson,
  idText,
  opScript,
} from "../../src/backend/mongo";
import {
  luaScript,
  parseInfo,
  parseKeyPage,
  parseValue,
  readOnlyRefusal,
  splitCommand,
  writeArgs,
} from "../../src/backend/redis";
import { buildScript } from "../../src/backend/script";
import { plainSql } from "../../src/backend/validate";
import { hasBash, startServer, type TestServer } from "./helpers";

const PASSWORD = 'p\'w "x" $y';

const login = (overrides: Partial<Conn>): Conn => ({
  engine: "mssql",
  address: "db.local",
  port: 1433,
  username: "sa",
  password: PASSWORD,
  database: "shop",
  runAs: "",
  ...overrides,
});

function posix(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
}

let bin = "";

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "fake-bin-"));
  for (const name of ["sqlcmd", "redis-cli", "mongosh"]) {
    const file = join(bin, name);
    writeFileSync(
      file,
      [
        "#!/bin/bash",
        'for a in "$@"; do echo "ARG:$a"; done',
        'echo "SQLCMDPASSWORD:$SQLCMDPASSWORD"',
        'echo "REDISCLI_AUTH:$REDISCLI_AUTH"',
        'echo "DB_PASS:$DB_PASS"',
        'echo "P3:$P3"',
        "",
      ].join("\n"),
    );
    chmodSync(file, 0o755);
  }
});

afterAll(() => {
  if (bin) rmSync(bin, { recursive: true, force: true });
});

function run(script: string) {
  const full = `export PATH="${posix(bin)}:$PATH"\n${script}`;
  return spawnSync("bash", ["-s"], { input: full, encoding: "utf8" });
}

describe("SQL Server output", () => {
  it("reads JSON split over lines and keeps big numbers exact", () => {
    const grid = parseJson(
      '[{"id":9007199254740993,"ok":true,"n":null,\n"t":"a\\nb"}]\n',
    );
    expect(grid).toEqual({
      columns: ["id", "ok", "n", "t"],
      rows: [["9007199254740993", "1", null, "a\nb"]],
    });
    expect(parseJson("")).toEqual({ columns: [], rows: [] });
  });

  it("reads the table output, trims padding and joins split values", () => {
    const sep = "\u001f";
    const grid = parseTable(
      [
        `a  ${sep}b    ${sep}c`,
        `---${sep}-----${sep}----`,
        `  1${sep}x y  ${sep}NULL`,
        `  2${sep}line1`,
        `line2${sep}z`,
        "",
      ].join("\n"),
    );
    expect(grid.columns).toEqual(["a", "b", "c"]);
    expect(grid.rows).toEqual([
      ["1", "x y", null],
      ["2", "line1\nline2", "z"],
    ]);
  });

  it("picks the shape by the JSON mark", () => {
    expect(parseMssql('@@JSON@@\n[{"v":1}]\n').rows).toEqual([["1"]]);
  });

  it("builds literals and pages without quotes", () => {
    expect(mssql.lit("a'b")).toBe(
      `CAST(0x${Buffer.from("a'b", "utf16le").toString("hex")} AS NVARCHAR(MAX))`,
    );
    expect(mssql.lit("")).toBe("CAST(N'' AS NVARCHAR(MAX))");
    expect(mssql.q("a]b")).toBe("[a]]b]");
    expect(mssql.page!("[dbo].[t]", "", "", 50, 100)).toContain(
      "ORDER BY (SELECT NULL) OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY",
    );
    expect(getEngine("mssql").defaultSchema).toBe("dbo");
    expect(() => getEngine("redis")).toThrow();
  });

  it("refuses sqlcmd commands in the console", () => {
    expect(() => plainSql("mssql", ":!! ls")).toThrow();
    expect(() => plainSql("mssql", "SELECT 1\nGO")).toThrow();
    expect(plainSql("mssql", "SELECT 1")).toBe("SELECT 1");
  });
});

describe.skipIf(!hasBash)("SQL Server scripts", () => {
  it("is valid bash and keeps the password out of the arguments", () => {
    for (const readOnly of [true, false]) {
      const script = buildScript(
        mssql,
        login({}),
        "shop",
        ["SELECT 1", mssql.databasesSql],
        readOnly,
      );
      expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
      expect(script).not.toContain("p'w");
    }
    const out = run(
      buildScript(mssql, login({}), "shop", [mssql.databasesSql], true),
    ).stdout;
    expect(out).toContain("ARG:-C\nARG:-X\nARG:-b");
    expect(out).toContain("ARG:-S\nARG:db.local,1433");
    expect(out).toContain("ARG:-U\nARG:sa");
    expect(out).toContain("ARG:-d\nARG:shop");
    expect(out).toContain("ARG:-y\nARG:0");
    expect(out).toContain("ROLLBACK TRANSACTION");
    expect(out.startsWith("@@JSON@@\n")).toBe(true);
    expect(out).toContain(`SQLCMDPASSWORD:${PASSWORD}`);
  });
});

describe("Redis", () => {
  it("splits a command line like redis-cli", () => {
    expect(splitCommand(`SET "a b" 'it\\'s' "x\\ny" \\x41`)).toEqual([
      "SET",
      "a b",
      "it's",
      "x\ny",
      "\\x41",
    ]);
    expect(splitCommand(`GET "\\x41"`)).toEqual(["GET", "A"]);
    expect(() => splitCommand(`GET "open`)).toThrow();
  });

  it("only lets reads through on a read only connection", () => {
    expect(readOnlyRefusal(["GET", "k"])).toBeNull();
    expect(readOnlyRefusal(["hgetall", "k"])).toBeNull();
    expect(readOnlyRefusal(["SET", "k", "v"])).toMatch(/read only/);
    expect(readOnlyRefusal(["CONFIG", "SET", "x", "y"])).toMatch(/not allowed/);
    expect(readOnlyRefusal(["CONFIG", "GET", "x"])).toBeNull();
    expect(readOnlyRefusal(["FLUSHALL"])).toMatch(/read only/);
  });

  it("builds the change arguments and checks them", () => {
    expect(writeArgs({ op: "set", key: "k", value: "v" })).toEqual([
      "SET",
      "k",
      "v",
      "KEEPTTL",
    ]);
    expect(writeArgs({ op: "expire", key: "k", ttl: null })).toEqual([
      "PERSIST",
      "k",
    ]);
    expect(writeArgs({ op: "zadd", key: "k", value: "m", score: 1.5 })).toEqual(
      ["ZADD", "k", "1.5", "m"],
    );
    expect(() => writeArgs({ op: "expire", key: "k", ttl: -1 })).toThrow();
    expect(() => writeArgs({ op: "set", key: "", value: "v" })).toThrow();
    expect(() =>
      writeArgs({ op: "flushall" as never, key: "k", value: "v" }),
    ).toThrow();
  });

  it("reads what the Lua scripts print", () => {
    expect(
      parseKeyPage('["17",[["a","hash",-1],["b","string",5000]]]'),
    ).toEqual({
      cursor: "17",
      keys: [
        { key: "a", type: "hash", ttl: -1 },
        { key: "b", type: "string", ttl: 5000 },
      ],
    });
    // cjson writes an empty table as {}.
    expect(parseKeyPage('["0",{}]').keys).toEqual([]);
    expect(
      parseValue('{"type":"hash","ttl":-1,"size":3,"value":["f","v"]}'),
    ).toMatchObject({ fields: [{ field: "f", value: "v" }], truncated: true });
    expect(
      parseValue('{"type":"zset","ttl":-1,"size":1,"value":["m","2"]}'),
    ).toMatchObject({ members: [{ member: "m", score: "2" }] });
    expect(
      parseValue(
        '{"type":"stream","ttl":-1,"size":1,"value":[["1-0",["a","1"]]]}',
      ),
    ).toMatchObject({ entries: [{ id: "1-0", fields: { a: "1" } }] });
    expect(parseValue('{"type":"none","ttl":-2}').type).toBe("none");
    expect(
      parseInfo(
        "redis_version:7.4.1\r\ndb0:keys=3,expires=0\r\ndb2:keys=1\r\n",
      ),
    ).toEqual({
      version: "7.4.1",
      databases: [
        { index: 0, keys: 3 },
        { index: 2, keys: 1 },
      ],
    });
  });
});

describe.skipIf(!hasBash)("Redis scripts", () => {
  it("passes keys as they are and the password in the environment", () => {
    const conn = login({ engine: "redis", port: 6390, database: "2" });
    const script = luaScript(
      conn,
      "",
      "return 1",
      ["a key\nwith 'quotes'\n"],
      ["10"],
    );
    expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
    expect(script).not.toContain("p'w");
    const out = run(script);
    // The fake redis-cli prints ARG lines, not JSON, so it reads as an error.
    expect(out.status).toBe(1);
    expect(out.stdout).toContain("DB_ERR:ARG:-p\nDB_ERR:ARG:6390");
    expect(out.stdout).toContain("DB_ERR:ARG:-n\nDB_ERR:ARG:2");
    expect(out.stdout).toContain(
      "DB_ERR:ARG:a key\nDB_ERR:with 'quotes'\nDB_ERR:\nDB_ERR:ARG:10",
    );
    expect(out.stdout).toContain(`DB_ERR:REDISCLI_AUTH:${PASSWORD}`);
  });
});

describe("MongoDB", () => {
  it("checks names and Extended JSON", () => {
    expect(dbName("shop")).toBe("shop");
    expect(() => dbName("a b")).toThrow();
    expect(() => dbName("a.b")).toThrow();
    expect(dbName("", false)).toBe("");
    expect(collectionName("system.items")).toBe("system.items");
    expect(() => collectionName("a$b")).toThrow();
    expect(ejson("", "The filter")).toBe("{}");
    expect(ejson('{"a":{"$gt":1}}', "The filter")).toBe('{"a":{"$gt":1}}');
    expect(() => ejson("[1]", "The filter")).toThrow(/object/);
    expect(() => ejson("{bad", "The filter")).toThrow(/JSON/);
    expect(idText('{"$oid":"6b0084ef6c42a6470fd3c596"}')).toContain("$oid");
    expect(() => idText("nope")).toThrow();
  });
});

describe.skipIf(!hasBash)("MongoDB scripts", () => {
  it("keeps the password and the filter out of the command line", () => {
    const conn = login({ engine: "mongo", port: 27017 });
    const script = opScript(conn, "find", [
      "shop",
      "items",
      '{"$where":"x"}',
      "{}",
      "0",
      "10",
    ]);
    expect(spawnSync("bash", ["-n"], { input: script }).status).toBe(0);
    expect(script).not.toContain("p'w");
    expect(script).not.toContain("$where");
    const out = run(script).stdout;
    expect(out).toContain("ARG:--nodb");
    expect(out).toContain(`DB_PASS:${PASSWORD}`);
    expect(out).toContain('P3:{"$where":"x"}');
    expect(out).not.toContain(`ARG:${PASSWORD}`);
    const console = consoleScript(conn, "shop", "db.items.find()");
    expect(spawnSync("bash", ["-n"], { input: console }).status).toBe(0);
  });
});

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function withLogin(engine: "redis" | "mongo", readOnly = false) {
  const s = (server = await startServer());
  const res = await s.request("POST", "/1/connections", {
    name: engine,
    engine,
    address: "127.0.0.1",
    port: null,
    username: "",
    password: "secret",
    database: engine === "redis" ? "0" : "shop",
    runAs: "",
    readOnly,
  });
  expect(res.status).toBe(200);
  return { s, id: res.body.id as number };
}

describe("Redis and MongoDB routes", () => {
  it("lists keys from the Lua scan", async () => {
    const { s, id } = await withLogin("redis");
    s.ssh.replies.push({
      match: "EVAL",
      stdout: '["0",[["user:1","string",-1]]]\n',
    });
    const res = await s.request("GET", `/1/connections/${id}/redis/keys?db=0`);
    expect(res.body).toEqual({
      cursor: "0",
      keys: [{ key: "user:1", type: "string", ttl: -1 }],
    });
    expect(s.ssh.calls[0].stdin).not.toContain("secret");
  });

  it("refuses changes on a read only login and wrong engines", async () => {
    const { s, id } = await withLogin("redis", true);
    const write = await s.request("POST", `/1/connections/${id}/redis/write`, {
      op: "delete",
      key: "k",
    });
    expect(write.status).toBe(403);
    const wrong = await s.request(
      "GET",
      `/1/connections/${id}/mongo/collections?db=x`,
    );
    expect(wrong.status).toBe(400);
    const sql = await s.request("GET", `/1/connections/${id}/tables`);
    expect(sql.status).toBe(400);
  });

  it("runs only reads in the console without edit access", async () => {
    const { s, id } = await withLogin("redis");
    s.setLevel("connect");
    const res = await s.request("POST", `/1/connections/${id}/redis/console`, {
      db: "0",
      line: "DEL k",
    });
    expect(res.status).toBe(403);
  });

  it("needs edit access for the mongosh shell", async () => {
    const { s, id } = await withLogin("mongo");
    s.setLevel("connect");
    const res = await s.request("POST", `/1/connections/${id}/mongo/console`, {
      db: "shop",
      code: "db.dropDatabase()",
    });
    expect(res.status).toBe(403);
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("finds documents and reads the JSON line", async () => {
    const { s, id } = await withLogin("mongo");
    s.ssh.replies.push({
      match: "mongosh",
      stdout: '{"docs":["{\\"_id\\":1}"],"total":1}\n',
    });
    const res = await s.request("POST", `/1/connections/${id}/mongo/find`, {
      db: "shop",
      collection: "items",
      filter: "{}",
    });
    expect(res.body).toEqual({ docs: ['{"_id":1}'], total: 1 });
  });
});
