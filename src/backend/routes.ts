import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { TableTarget } from "../shared/types.js";
import type { Conn } from "./engines/index.js";
import { DatabasesError } from "./errors.js";
import {
  toView,
  type ConnectionRecord,
  type Repository,
} from "./repository.js";
import type { Service } from "./service.js";
import {
  connectionInput,
  filter,
  integer,
  MAX_ROWS,
  name,
  plainSql,
  rowValues,
} from "./validate.js";

export interface Deps {
  repo: Repository;
  service: Service;
}

type Level = "connect" | "edit";

/** Maps a thrown error to a JSON answer. Unknown errors are not shown. */
function fail(ctx: PluginContext, res: Response, error: unknown): void {
  if (error instanceof DatabasesError) {
    res.status(error.status).json({ error: error.message, ...error.extra });
    return;
  }
  ctx.log.warn(
    `Databases request failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  res.status(500).json({ error: "Something went wrong" });
}

/**
 * Mounts the routes on the plugin's router, which core serves at
 * /plugin-api/databases with auth and the databases.use permission in front.
 * Reading needs connect access to the host, changes need edit access.
 */
export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  deps: Deps,
): void {
  const { repo, service } = deps;

  router.use(ctx.rbac.require("use") as never);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  async function gate(hostId: number, level: Level): Promise<void> {
    if (!Number.isInteger(hostId) || hostId < 1) {
      throw new DatabasesError("The host id is not valid");
    }
    if ((await ctx.hosts.checkAccess(hostId, level)).hasAccess) return;
    if (
      level === "edit" &&
      (await ctx.hosts.checkAccess(hostId, "connect")).hasAccess
    ) {
      throw new DatabasesError("You need edit access to this host", 403, {
        code: "HOST_EDIT_REQUIRED",
      });
    }
    throw new DatabasesError("Host not found", 404);
  }

  async function record(
    hostId: number,
    req: Request,
  ): Promise<ConnectionRecord> {
    const id = Number(req.params.connId);
    const found = Number.isInteger(id) ? await repo.get(hostId, id) : null;
    if (!found) throw new DatabasesError("Connection not found", 404);
    return found;
  }

  const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

  function target(source: Record<string, unknown>): TableTarget {
    return {
      db: name(source.db, "The database", false),
      schema: name(source.schema, "The schema", false),
      table: name(source.table, "The table"),
    };
  }

  /** A read: needs connect access. */
  const read =
    (run: (hostId: number, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        const hostId = Number(req.params.hostId);
        await gate(hostId, "connect");
        res.json(await run(hostId, req));
      } catch (error) {
        fail(ctx, res, error);
      }
    };

  /** A read on one saved connection, with its login opened. */
  const onConnection = (
    run: (
      hostId: number,
      conn: Conn,
      rec: ConnectionRecord,
      req: Request,
    ) => Promise<unknown>,
  ) =>
    read(async (hostId, req) => {
      const rec = await record(hostId, req);
      return run(hostId, await repo.login(rec), rec, req);
    });

  /** A change: needs edit access and is written to the audit log. */
  const write =
    (
      action: string,
      run: (hostId: number, req: Request) => Promise<unknown>,
      label?: (req: Request) => string | undefined,
    ) =>
    async (req: Request, res: Response) => {
      const hostId = Number(req.params.hostId);
      const resourceName = label?.(req);
      try {
        await gate(hostId, "edit");
        const result = await run(hostId, req);
        void ctx.audit.record({
          action: `databases.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName,
          success: true,
        });
        res.json(result ?? { ok: true });
      } catch (error) {
        void ctx.audit.record({
          action: `databases.${action}`,
          resourceType: "host",
          resourceId: String(hostId),
          resourceName,
          success: false,
          errorMessage: error instanceof Error ? error.message : undefined,
        });
        fail(ctx, res, error);
      }
    };

  /** A change to data: edit access, and the connection must not be read only. */
  const writeRows = (
    action: string,
    run: (hostId: number, conn: Conn, req: Request) => Promise<unknown>,
  ) =>
    write(
      action,
      async (hostId, req) => {
        const rec = await record(hostId, req);
        if (rec.readOnly) {
          throw new DatabasesError("This connection is read only", 403);
        }
        return run(hostId, await repo.login(rec), req);
      },
      (req) => {
        const table = body(req).table;
        return typeof table === "string" ? table : undefined;
      },
    );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/tools:
   *   get:
   *     summary: Database clients on a host
   *     description: Reports which of mysql, psql and sqlite3 are installed on the host and their versions.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The installed clients, or null for a missing one.
   */
  router.get(
    "/:hostId/tools",
    read((hostId) => service.tools(hostId)),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections:
   *   get:
   *     summary: List saved connections
   *     description: Returns the saved database logins of a host. Passwords are never returned.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The saved connections.
   */
  router.get(
    "/:hostId/connections",
    read(async (hostId) => (await repo.list(hostId)).map(toView)),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections:
   *   post:
   *     summary: Save a connection
   *     description: Saves a database login for a host. The password is sealed before it is stored.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The saved connection.
   */
  router.post(
    "/:hostId/connections",
    write(
      "connection.create",
      async (hostId, req) =>
        toView(
          await repo.create(
            hostId,
            ctx.currentActor() as string,
            connectionInput(req.body),
          ),
        ),
      (req) => String(body(req).name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/test:
   *   post:
   *     summary: Test a connection
   *     description: Connects with the given login and returns the server version. Send id to reuse the saved password.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The server version.
   */
  router.post("/:hostId/connections/test", async (req, res) => {
    try {
      const hostId = Number(req.params.hostId);
      await gate(hostId, "edit");
      const input = connectionInput(req.body);
      let conn: Conn = {
        engine: input.engine,
        address: input.address,
        port: input.port,
        username: input.username,
        password: input.password,
        database: input.database,
        runAs: input.runAs,
      };
      const savedId = Number(body(req).id);
      if (!input.password && Number.isInteger(savedId) && savedId > 0) {
        const saved = await repo.get(hostId, savedId);
        if (saved && saved.engine === input.engine && !input.clearPassword) {
          conn = { ...conn, password: (await repo.login(saved)).password };
        }
      }
      res.json(await service.test(hostId, conn));
    } catch (error) {
      fail(ctx, res, error);
    }
  });

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}:
   *   put:
   *     summary: Update a connection
   *     description: Changes a saved login. An empty password keeps the saved one.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The updated connection.
   */
  router.put(
    "/:hostId/connections/:connId",
    write(
      "connection.update",
      async (hostId, req) => {
        const existing = await record(hostId, req);
        await repo.update(existing, connectionInput(req.body));
        return toView((await repo.get(hostId, existing.id)) ?? existing);
      },
      (req) => String(body(req).name ?? ""),
    ),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}:
   *   delete:
   *     summary: Delete a connection
   *     description: Removes a saved login. The database itself is not touched.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The connection was removed.
   */
  router.delete(
    "/:hostId/connections/:connId",
    write("connection.delete", async (hostId, req) => {
      const existing = await record(hostId, req);
      await repo.remove(existing.id);
    }),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/databases:
   *   get:
   *     summary: List databases
   *     description: Lists the databases the login can see. System databases are left out.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The database names.
   */
  router.get(
    "/:hostId/connections/:connId/databases",
    onConnection((hostId, conn) => service.databases(hostId, conn)),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/tables:
   *   get:
   *     summary: List tables
   *     description: Lists the tables and views of a database.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: db
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The tables and views.
   */
  router.get(
    "/:hostId/connections/:connId/tables",
    onConnection((hostId, conn, _rec, req) =>
      service.tables(hostId, conn, name(req.query.db, "The database", false)),
    ),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/routines:
   *   get:
   *     summary: List stored procedures and functions
   *     description: Lists the stored procedures and functions of a database with their definitions. Empty for SQLite.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: db
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The procedures and functions.
   */
  router.get(
    "/:hostId/connections/:connId/routines",
    onConnection((hostId, conn, _rec, req) =>
      service.routines(hostId, conn, name(req.query.db, "The database", false)),
    ),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/describe:
   *   get:
   *     summary: Describe a table
   *     description: Returns the columns and indexes of a table.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: query
   *         name: db
   *         schema:
   *           type: string
   *       - in: query
   *         name: schema
   *         schema:
   *           type: string
   *       - in: query
   *         name: table
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The columns and indexes.
   */
  router.get(
    "/:hostId/connections/:connId/describe",
    onConnection((hostId, conn, _rec, req) =>
      service.describe(
        hostId,
        conn,
        target(req.query as Record<string, unknown>),
      ),
    ),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/rows:
   *   post:
   *     summary: Read rows of a table
   *     description: Returns a page of rows with the column list and the total count. The body takes db, schema, table, limit, offset, orderBy, dir and a where condition.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The rows and columns.
   */
  router.post(
    "/:hostId/connections/:connId/rows",
    onConnection((hostId, conn, _rec, req) => {
      const b = body(req);
      return service.rows(hostId, conn, {
        ...target(b),
        limit: integer(b.limit, "The limit", 1, MAX_ROWS, 100),
        offset: integer(b.offset, "The offset", 0, 1_000_000_000, 0),
        orderBy: name(b.orderBy, "The sort column", false),
        dir: b.dir === "desc" ? "desc" : "asc",
        where: filter(b.where),
      });
    }),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/row:
   *   post:
   *     summary: Insert a row
   *     description: Adds a row. Needs edit access and a connection that is not read only.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The number of rows added.
   */
  router.post(
    "/:hostId/connections/:connId/row",
    writeRows("row.insert", (hostId, conn, req) => {
      const b = body(req);
      return service.insert(hostId, conn, {
        ...target(b),
        values: rowValues(b.values, "The values"),
      });
    }),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/row:
   *   put:
   *     summary: Update a row
   *     description: Changes a row found by its primary key. Tables without a primary key cannot be edited.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The number of rows changed.
   */
  router.put(
    "/:hostId/connections/:connId/row",
    writeRows("row.update", (hostId, conn, req) => {
      const b = body(req);
      return service.update(hostId, conn, {
        ...target(b),
        key: rowValues(b.key, "The key"),
        values: rowValues(b.values, "The values"),
      });
    }),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/row/delete:
   *   post:
   *     summary: Delete a row
   *     description: Removes a row found by its primary key.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The number of rows removed.
   */
  router.post(
    "/:hostId/connections/:connId/row/delete",
    writeRows("row.delete", (hostId, conn, req) => {
      const b = body(req);
      return service.remove(hostId, conn, {
        ...target(b),
        key: rowValues(b.key, "The key"),
      });
    }),
  );

  /**
   * @openapi
   * /plugin-api/databases/{hostId}/connections/{connId}/query:
   *   post:
   *     summary: Run SQL
   *     description: Runs SQL in the console. The session is read only unless the user has edit access to the host and the connection is not read only.
   *     tags:
   *       - Databases
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *       - in: path
   *         name: connId
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: The result rows and timing.
   */
  router.post("/:hostId/connections/:connId/query", async (req, res) => {
    const hostId = Number(req.params.hostId);
    let writable = false;
    let label = "";
    try {
      await gate(hostId, "connect");
      const rec = await record(hostId, req);
      label = rec.name;
      writable =
        !rec.readOnly &&
        (await ctx.hosts.checkAccess(hostId, "edit")).hasAccess;
      const b = body(req);
      const sql = plainSql(rec.engine, b.sql);
      const result = await service.query(
        hostId,
        await repo.login(rec),
        name(b.db, "The database", false),
        sql,
        !writable,
      );
      if (writable) {
        void ctx.audit.record({
          action: "databases.query",
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: label,
          success: true,
        });
      }
      res.json(result);
    } catch (error) {
      if (writable) {
        void ctx.audit.record({
          action: "databases.query",
          resourceType: "host",
          resourceId: String(hostId),
          resourceName: label,
          success: false,
          errorMessage: error instanceof Error ? error.message : undefined,
        });
      }
      fail(ctx, res, error);
    }
  });
}
