import {
  boolean,
  defineTable,
  id,
  integer,
  refHost,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix-ssh/plugin-sdk/db";

// Stored as p_databases_connections.
export const connections = defineTable(
  "connections",
  {
    id: id(),
    uid: varchar(36).notNull().unique(),
    hostId: refHost(),
    userId: refUser(),
    name: varchar(120).notNull(),
    kind: varchar(10).notNull(),
    address: varchar(255).notNull().default(""),
    port: integer(),
    username: varchar(128).notNull().default(""),
    passwordSealed: text(),
    dbName: varchar(1024).notNull().default(""),
    runAs: varchar(64).notNull().default(""),
    readOnly: boolean().notNull().default(false),
    createdAt: timestamp().notNull().defaultNow(),
  },
  {
    indexes: [
      { name: "idx_p_databases_connections_host_id", columns: ["hostId"] },
    ],
  },
);

// termix-plugin migrations reads this list.
export const tables = [connections];
