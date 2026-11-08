import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseLoginsV1 } from "../../src/backend/services.js";
import { startServer, type TestServer } from "./helpers";

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

function logins(s: TestServer): DatabaseLoginsV1 {
  return s.mock.services.get("databases.logins") as DatabaseLoginsV1;
}

describe("databases.logins service", () => {
  it("lists logins without passwords and resolves one", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/connections", LOGIN);
    const id = res.body.id as number;
    const list = await logins(server).list(1);
    expect(list).toEqual([
      { id, name: "shop", engine: "mysql", database: "shop" },
    ]);
    expect(JSON.stringify(list)).not.toContain("hunter2");
    const login = await logins(server).resolve(1, id);
    expect(login).toMatchObject({ username: "root", password: "hunter2" });
    expect(await logins(server).resolve(1, id + 99)).toBeNull();
  });

  it("needs edit access to read a password", async () => {
    server = await startServer();
    const res = await server.request("POST", "/1/connections", LOGIN);
    server.setLevel("connect");
    expect(await logins(server).list(1)).toHaveLength(1);
    await expect(logins(server).resolve(1, res.body.id)).rejects.toThrow(
      "No access",
    );
    server.setLevel("none");
    await expect(logins(server).list(1)).rejects.toThrow("No access");
  });
});
