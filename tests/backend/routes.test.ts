import { afterEach, describe, expect, it } from "vitest";
import { startServer, statements, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const LOGIN = {
  name: "shop",
  engine: "mysql",
  address: "127.0.0.1",
  port: 3306,
  username: "root",
  password: "hunter2",
  database: "shop",
  runAs: "",
  readOnly: false,
};

const COLUMNS =
  "column_name\tcolumn_type\tx\ty\tz\textra\n" +
  "id\tint\t0\t1\tNULL\tauto_increment\n" +
  "name\tvarchar(20)\t1\t0\tNULL\t\n";

async function withLogin(
  overrides: Record<string, unknown> = {},
): Promise<{ s: TestServer; id: number }> {
  const s = (server = await startServer());
  const res = await s.request("POST", "/1/connections", {
    ...LOGIN,
    ...overrides,
  });
  expect(res.status).toBe(200);
  return { s, id: res.body.id };
}

describe("connections", () => {
  it("saves a login and never returns the password", async () => {
    const { s, id } = await withLogin();
    const list = await s.request("GET", "/1/connections");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, name: "shop", hasPassword: true });
    expect(JSON.stringify(list.body)).not.toContain("hunter2");
    expect(list.body[0].passwordSealed).toBeUndefined();
  });

  it("keeps the password when an edit leaves it empty", async () => {
    const { s, id } = await withLogin();
    const put = await s.request("PUT", `/1/connections/${id}`, {
      ...LOGIN,
      password: "",
      name: "renamed",
    });
    expect(put.body).toMatchObject({ name: "renamed", hasPassword: true });
    const cleared = await s.request("PUT", `/1/connections/${id}`, {
      ...LOGIN,
      password: "",
      clearPassword: true,
    });
    expect(cleared.body.hasPassword).toBe(false);
  });

  it("deletes a login", async () => {
    const { s, id } = await withLogin();
    expect((await s.request("DELETE", `/1/connections/${id}`)).status).toBe(
      200,
    );
    expect((await s.request("GET", "/1/connections")).body).toEqual([]);
  });

  it("needs edit access to change logins but not to list them", async () => {
    server = await startServer({ level: "connect" });
    expect((await server.request("GET", "/1/connections")).status).toBe(200);
    const post = await server.request("POST", "/1/connections", LOGIN);
    expect(post.status).toBe(403);
    expect(post.body.code).toBe("HOST_EDIT_REQUIRED");
  });

  it("hides the host when there is no access", async () => {
    server = await startServer({ level: "none" });
    expect((await server.request("GET", "/1/connections")).status).toBe(404);
  });

  it("needs the use permission", async () => {
    server = await startServer({ permissions: [] });
    expect((await server.request("GET", "/1/connections")).status).toBe(403);
  });

  it("rejects a bad login", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/connections", {
      ...LOGIN,
      engine: "oracle",
    });
    expect(res.status).toBe(400);
  });

  it("does not use a connection from another host", async () => {
    const { s, id } = await withLogin();
    const res = await s.request("GET", `/2/connections/${id}/databases`);
    expect(res.status).toBe(404);
  });
});

describe("test and scripts", () => {
  it("tests a login and keeps the password out of the command", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "VERSION()",
      stdout: "VERSION()\n8.0.36\n",
    });
    const res = await server.request("POST", "/1/connections/test", LOGIN);
    expect(res.body).toEqual({ version: "8.0.36" });
    const call = server.ssh.calls[0];
    expect(call.command).not.toContain("hunter2");
    expect(call.stdin).not.toContain("hunter2");
    expect(call.stdin).toContain("MYSQL_PWD");
    expect(call.stdin).toContain("--init-command");
  });

  it("reports a missing client", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "command -v",
      stdout: "DB_ERR:mysql is not installed on this host\n",
      code: 127,
    });
    const res = await server.request("POST", "/1/connections/test", LOGIN);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("mysql is not installed");
  });

  it("asks for sudo when run as another user fails", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "SQL=",
      stderr: "sudo: a password is required",
      code: 1,
    });
    const res = await server.request("POST", "/1/connections/test", {
      ...LOGIN,
      engine: "postgres",
      runAs: "postgres",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("sudo");
    expect(server.ssh.calls[0].command).toContain("sudo -n -u postgres");
  });

  it("reads which clients are installed", async () => {
    server = await startServer();
    server.ssh.replies.push({
      match: "for t in",
      stdout: "mysql=mysql  Ver 8\npsql=\nsqlite3=3.45.1\n",
    });
    const res = await server.request("GET", "/1/tools");
    expect(res.body).toEqual({
      mysql: "mysql  Ver 8",
      psql: null,
      sqlite3: "3.45.1",
    });
  });
});

describe("routines", () => {
  it("lists procedures and functions with their definitions", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({
      match: "information_schema.routines",
      stdout:
        "routine_schema\troutine_name\tkind\tdefinition\n" +
        "shop\tadd_order\tprocedure\tBEGIN\\n  SELECT 1;\\nEND\n" +
        "shop\ttotal\tfunction\tNULL\n",
    });
    const res = await s.request("GET", `/1/connections/${id}/routines?db=shop`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        schema: "shop",
        name: "add_order",
        kind: "procedure",
        definition: "BEGIN\n  SELECT 1;\nEND",
      },
      { schema: "shop", name: "total", kind: "function", definition: null },
    ]);
  });

  it("has none for SQLite", async () => {
    const { s, id } = await withLogin({
      engine: "sqlite",
      address: "",
      port: null,
      username: "",
      password: "",
      database: "/tmp/app.db",
    });
    const res = await s.request("GET", `/1/connections/${id}/routines`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("rows", () => {
  it("builds the page, count and column queries", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({
      match: "information_schema.columns",
      stdout: COLUMNS,
    });
    const res = await s.request("POST", `/1/connections/${id}/rows`, {
      db: "shop",
      table: "users",
      limit: 50,
      offset: 100,
      orderBy: "name",
      dir: "desc",
      where: "id > 3",
    });
    expect(res.status).toBe(200);
    const sql = statements(s.ssh.calls[0].stdin);
    expect(sql[1]).toBe(
      "SELECT COUNT(*) AS n FROM `shop`.`users` WHERE id > 3",
    );
    expect(sql[2]).toBe(
      "SELECT * FROM `shop`.`users` WHERE id > 3 ORDER BY `name` DESC LIMIT 50 OFFSET 100",
    );
  });

  it("quotes names so they cannot break out", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({
      match: "information_schema.columns",
      stdout: COLUMNS,
    });
    await s.request("POST", `/1/connections/${id}/rows`, {
      db: "shop",
      table: "a`b; DROP TABLE x",
      orderBy: "c`d",
    });
    const sql = statements(s.ssh.calls[0].stdin);
    expect(sql[2]).toContain("`shop`.`a``b; DROP TABLE x`");
    expect(sql[2]).toContain("ORDER BY `c``d`");
  });

  it("refuses a filter with a second statement", async () => {
    const { s, id } = await withLogin();
    const res = await s.request("POST", `/1/connections/${id}/rows`, {
      db: "shop",
      table: "users",
      where: "1=1; DROP TABLE users",
    });
    expect(res.status).toBe(400);
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("updates a row by key and sends values as base64", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push(
      { match: "information_schema.columns", stdout: COLUMNS },
      { match: "ROW_COUNT", stdout: "n\n1\n" },
    );
    const res = await s.request("PUT", `/1/connections/${id}/row`, {
      db: "shop",
      table: "users",
      key: { id: "7" },
      values: { name: "O'Brien" },
    });
    expect(res.body).toEqual({ affected: 1 });
    const stdin = s.ssh.calls[1].stdin;
    expect(stdin).not.toContain("O'Brien");
    const sql = statements(stdin)[0];
    expect(sql).toContain(
      "UPDATE `shop`.`users` SET `name` = CONVERT(FROM_BASE64('",
    );
    expect(sql).toContain("WHERE `id` = CONVERT(FROM_BASE64('");
    expect(sql).toContain("SELECT ROW_COUNT() AS n");
  });

  it("will not edit a table without a primary key", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({
      match: "information_schema.columns",
      stdout: "a\tb\tc\td\te\tf\nname\tvarchar(20)\t1\t0\tNULL\t\n",
    });
    const res = await s.request("PUT", `/1/connections/${id}/row`, {
      db: "shop",
      table: "log",
      key: {},
      values: { name: "x" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("primary key");
  });

  it("will not edit binary columns", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({
      match: "information_schema.columns",
      stdout:
        "a\tb\tc\td\te\tf\nid\tint\t0\t1\tNULL\t\nimg\tblob\t1\t0\tNULL\t\n",
    });
    const res = await s.request("PUT", `/1/connections/${id}/row`, {
      db: "shop",
      table: "pics",
      key: { id: "1" },
      values: { img: "x" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("cannot be edited");
  });

  it("blocks row changes on a read only login", async () => {
    const { s, id } = await withLogin({ readOnly: true });
    for (const [method, path] of [
      ["POST", "row"],
      ["PUT", "row"],
      ["POST", "row/delete"],
    ]) {
      const res = await s.request(method, `/1/connections/${id}/${path}`, {
        db: "shop",
        table: "users",
        key: { id: "1" },
        values: { name: "x" },
      });
      expect(res.status).toBe(403);
    }
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("needs edit access for row changes", async () => {
    const { s, id } = await withLogin();
    s.setLevel("connect");
    const res = await s.request("POST", `/1/connections/${id}/row`, {
      db: "shop",
      table: "users",
      values: {},
    });
    expect(res.status).toBe(403);
    expect(s.ssh.calls).toHaveLength(0);
  });
});

describe("console", () => {
  it("allows changes for an editor", async () => {
    const { s, id } = await withLogin();
    s.ssh.replies.push({ match: "SELECT 1", stdout: "1\n1\n" });
    const res = await s.request("POST", `/1/connections/${id}/query`, {
      db: "shop",
      sql: "SELECT 1",
    });
    expect(res.body).toMatchObject({ readOnly: false, columns: ["1"] });
    expect(s.ssh.calls[0].stdin).not.toContain("READ ONLY");
  });

  it("runs read only for a user without edit access", async () => {
    const { s, id } = await withLogin();
    s.setLevel("connect");
    s.ssh.replies.push({ match: "SELECT 1", stdout: "1\n1\n" });
    const res = await s.request("POST", `/1/connections/${id}/query`, {
      db: "shop",
      sql: "SELECT 1",
    });
    expect(res.body.readOnly).toBe(true);
    expect(s.ssh.calls[0].stdin).toContain("READ ONLY");
  });

  it("is read only when the login is read only", async () => {
    const { s, id } = await withLogin({ readOnly: true });
    s.ssh.replies.push({ match: "SELECT 1", stdout: "1\n1\n" });
    const res = await s.request("POST", `/1/connections/${id}/query`, {
      db: "shop",
      sql: "SELECT 1",
    });
    expect(res.body.readOnly).toBe(true);
    expect(s.ssh.calls[0].stdin).toContain("READ ONLY");
  });

  it("refuses client commands", async () => {
    const { s, id } = await withLogin();
    const res = await s.request("POST", `/1/connections/${id}/query`, {
      db: "shop",
      sql: "system id",
    });
    expect(res.status).toBe(400);
    expect(s.ssh.calls).toHaveLength(0);
  });

  it("cuts long results", async () => {
    const { s, id } = await withLogin();
    const rows = Array.from({ length: 1200 }, (_, i) => String(i)).join("\n");
    s.ssh.replies.push({ match: "SELECT n", stdout: `n\n${rows}\n` });
    const res = await s.request("POST", `/1/connections/${id}/query`, {
      db: "shop",
      sql: "SELECT n",
    });
    expect(res.body.rows).toHaveLength(1000);
    expect(res.body.truncated).toBe(true);
  });
});
