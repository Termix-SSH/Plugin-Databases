import type { EngineId, SqlEngineId } from "../../shared/types.js";
import { DatabasesError } from "../errors.js";
import { mssql } from "./mssql.js";
import { mysql } from "./mysql.js";
import { postgres } from "./postgres.js";
import { sqlite } from "./sqlite.js";
import type { Engine } from "./types.js";

const ENGINE_MAP: Record<SqlEngineId, Engine> = {
  mysql,
  postgres,
  sqlite,
  mssql,
};

/** The SQL engine for a connection. Redis and MongoDB have none. */
export function getEngine(id: EngineId): Engine {
  const engine = (ENGINE_MAP as Record<string, Engine | undefined>)[id];
  if (!engine) {
    throw new DatabasesError("This does not work on this database type");
  }
  return engine;
}

export type { Conn, Engine } from "./types.js";
