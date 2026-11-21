import type { MongoCollection, MongoFind, MongoPage } from "../shared/types.js";
import type { Conn } from "./engines/index.js";
import { DatabasesError } from "./errors.js";
import type { Remote } from "./remote.js";

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const setVar = (name: string, value: string) =>
  `${name}="$(printf %s '${b64(value)}' | base64 -d)"`;

export const MAX_DOCS = 200;
const MAX_TEXT = 1_000_000;
// eslint-disable-next-line no-control-regex
const NAME = /^[^\u0000$/\\. "]{1,63}$/;
// eslint-disable-next-line no-control-regex
const COLLECTION = /^[^\u0000$]{1,255}$/;

/**
 * Runs before every operation: builds the URI from env vars so the password
 * is never on a command line, and gives the op an `out` helper.
 */
const PRELUDE = `
// mongosh reads these on the host, not this plugin.
const D = (n) => process.env["DB_" + n] || "";
const auth = D("USER")
  ? encodeURIComponent(D("USER")) + ":" + encodeURIComponent(D("PASS") || "") + "@"
  : "";
const host = D("ADDR") || "127.0.0.1";
const uriFor = (source) => "mongodb://" + auth +
  (host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host) +
  ":" + (D("PORT") || "27017") + "/?serverSelectionTimeoutMS=8000&authSource=" +
  encodeURIComponent(source);
// Users usually live in admin; an app user may live in its own database.
const open = () => {
  try {
    return connect(uriFor("admin"));
  } catch (e) {
    if (D("USER") && D("NAME") && /auth/i.test(String(e && e.message))) {
      return connect(uriFor(D("NAME")));
    }
    throw e;
  }
};
const P = (n) => process.env["P" + n] ?? "";
const J = (n) => EJSON.parse(P(n) || "{}");
const out = (value) => print(EJSON.stringify(value, { relaxed: true }));
`;

const TRY = `
try {
  const conn = open();
  const pick = (name) => conn.getSiblingDB(name || D("NAME") || "test");
`;

const END = `
} catch (e) {
  print("DB_ERR:" + (e && e.message ? e.message : String(e)));
  quit(1);
}
`;

/** One JS body per operation. Parameters come in as P1, P2, ... */
export const OPS = {
  version: `out({ version: conn.version() });`,
  databases: `
  let names;
  try {
    names = conn.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((d) => d.name);
  } catch (e) {
    names = D("NAME") ? [D("NAME")] : [];
  }
  out(names);`,
  collections: `
  const db = pick(P(1));
  const infos = db.getCollectionInfos({}, { nameOnly: false });
  out(infos.map((info) => {
    let count = null;
    if (info.type !== "view") {
      try { count = db.getCollection(info.name).estimatedDocumentCount(); } catch (e) {}
    }
    return { name: info.name, type: info.type || "collection", count };
  }));`,
  find: `
  const c = pick(P(1)).getCollection(P(2));
  const filter = J(3);
  const sort = J(4);
  const docs = c.find(filter).sort(sort).skip(Number(P(5))).limit(Number(P(6))).maxTimeMS(20000).toArray();
  let total = null;
  try { total = c.countDocuments(filter, { maxTimeMS: 5000 }); } catch (e) {}
  print(JSON.stringify({ docs: docs.map((d) => EJSON.stringify(d, { relaxed: true })), total }));`,
  indexes: `out(pick(P(1)).getCollection(P(2)).getIndexes());`,
  insert: `
  const r = pick(P(1)).getCollection(P(2)).insertOne(J(3));
  out({ id: r.insertedId });`,
  replace: `
  const id = EJSON.parse(P(3));
  const doc = J(4);
  delete doc._id;
  const r = pick(P(1)).getCollection(P(2)).replaceOne({ _id: id }, doc);
  out({ matched: r.matchedCount, modified: r.modifiedCount });`,
  remove: `
  const r = pick(P(1)).getCollection(P(2)).deleteOne({ _id: EJSON.parse(P(3)) });
  out({ deleted: r.deletedCount });`,
} as const;

export type MongoOp = keyof typeof OPS;

function prelude(conn: Conn): string[] {
  const lines = [
    'command -v mongosh >/dev/null 2>&1 || { echo "DB_ERR:mongosh is not installed on this host"; exit 127; }',
    `export ${setVar("DB_ADDR", conn.address)}`,
    `export ${setVar("DB_PORT", conn.port ? String(conn.port) : "")}`,
    `export ${setVar("DB_USER", conn.username)}`,
    `export ${setVar("DB_NAME", conn.database)}`,
  ];
  if (conn.password) lines.push(`export ${setVar("DB_PASS", conn.password)}`);
  return lines;
}

/** A script that runs one operation with mongosh and prints its JSON. */
export function opScript(conn: Conn, op: MongoOp, params: string[]): string {
  return [
    ...prelude(conn),
    ...params.map((value, index) => `export ${setVar(`P${index + 1}`, value)}`),
    setVar("MJS", PRELUDE + TRY + OPS[op] + END),
    'mongosh --quiet --norc --nodb --eval "$MJS" </dev/null',
    "",
  ].join("\n");
}

/** The console: the person's own code with `db` set to the chosen database. */
export function consoleScript(conn: Conn, db: string, code: string): string {
  const setup =
    PRELUDE + "db = open().getSiblingDB(P(1) || D('NAME') || 'test');\n";
  return [
    ...prelude(conn),
    `export ${setVar("P1", db)}`,
    setVar("MJS", `${setup}${code}\n`),
    'mongosh --quiet --norc --nodb --eval "$MJS" </dev/null 2>&1',
    "",
  ].join("\n");
}

export function dbName(value: unknown, required = true): string {
  const text = typeof value === "string" ? value : "";
  if (!text) {
    if (required) throw new DatabasesError("Pick a database");
    return "";
  }
  if (!NAME.test(text))
    throw new DatabasesError("The database name is not valid");
  return text;
}

export function collectionName(value: unknown): string {
  if (typeof value !== "string" || !COLLECTION.test(value)) {
    throw new DatabasesError("The collection name is not valid");
  }
  return value;
}

/** Extended JSON text, checked to be a JSON object before it goes out. */
export function ejson(value: unknown, label: string, fallback = "{}"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || value.length > MAX_TEXT) {
    throw new DatabasesError(`${label} is not valid`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DatabasesError(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DatabasesError(`${label} must be a JSON object`);
  }
  return value;
}

/** An _id as Extended JSON, like {"$oid":"..."} or a plain value. */
export function idText(value: unknown): string {
  if (typeof value !== "string" || value.length > 10_000) {
    throw new DatabasesError("The document id is not valid");
  }
  try {
    JSON.parse(value);
  } catch {
    throw new DatabasesError("The document id is not valid");
  }
  return value;
}

function parse<T>(output: string): T {
  const line = output.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new DatabasesError("MongoDB sent an answer that could not be read");
  }
}

export function createMongo(remote: Remote) {
  const op = async <T>(
    hostId: number,
    conn: Conn,
    name: MongoOp,
    params: string[] = [],
  ): Promise<T> =>
    parse<T>(
      await remote.run(hostId, conn.runAs, opScript(conn, name, params)),
    );

  return {
    async version(hostId: number, conn: Conn): Promise<string> {
      const result = await op<{ version: string }>(hostId, conn, "version");
      return `MongoDB ${result.version}`;
    },

    databases: (hostId: number, conn: Conn) =>
      op<string[]>(hostId, conn, "databases"),

    collections: (hostId: number, conn: Conn, db: string) =>
      op<MongoCollection[]>(hostId, conn, "collections", [dbName(db)]),

    find(hostId: number, conn: Conn, req: MongoFind): Promise<MongoPage> {
      const limit = Math.min(
        Math.max(Math.floor(req.limit) || 50, 1),
        MAX_DOCS,
      );
      const skip = Math.max(Math.floor(req.skip) || 0, 0);
      return op<MongoPage>(hostId, conn, "find", [
        dbName(req.db),
        collectionName(req.collection),
        ejson(req.filter, "The filter"),
        ejson(req.sort, "The sort"),
        String(skip),
        String(limit),
      ]);
    },

    indexes: (hostId: number, conn: Conn, db: string, collection: string) =>
      op<unknown[]>(hostId, conn, "indexes", [
        dbName(db),
        collectionName(collection),
      ]),

    insert: (
      hostId: number,
      conn: Conn,
      db: string,
      collection: string,
      doc: unknown,
    ) =>
      op<{ id: unknown }>(hostId, conn, "insert", [
        dbName(db),
        collectionName(collection),
        ejson(doc, "The document"),
      ]),

    replace: (
      hostId: number,
      conn: Conn,
      db: string,
      collection: string,
      id: unknown,
      doc: unknown,
    ) =>
      op<{ matched: number; modified: number }>(hostId, conn, "replace", [
        dbName(db),
        collectionName(collection),
        idText(id),
        ejson(doc, "The document"),
      ]),

    remove: (
      hostId: number,
      conn: Conn,
      db: string,
      collection: string,
      id: unknown,
    ) =>
      op<{ deleted: number }>(hostId, conn, "remove", [
        dbName(db),
        collectionName(collection),
        idText(id),
      ]),

    async console(
      hostId: number,
      conn: Conn,
      db: string,
      code: unknown,
    ): Promise<{ output: string }> {
      if (typeof code !== "string" || !code.trim()) {
        throw new DatabasesError("Enter some code to run");
      }
      if (code.length > MAX_TEXT)
        throw new DatabasesError("The code is too long");
      const output = await remote.run(
        hostId,
        conn.runAs,
        consoleScript(conn, dbName(db, false), code),
        60_000,
      );
      return { output: output.replace(/\n$/, "") };
    },
  };
}

export type MongoService = ReturnType<typeof createMongo>;
