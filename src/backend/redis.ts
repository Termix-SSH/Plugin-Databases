import type {
  RedisInfo,
  RedisKey,
  RedisKeyPage,
  RedisValue,
  RedisWrite,
} from "../shared/types.js";
import type { Conn } from "./engines/index.js";
import { DatabasesError } from "./errors.js";
import type { Remote } from "./remote.js";

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const setVar = (name: string, value: string) =>
  `${name}="$(printf %s '${b64(value)}' | base64 -d)"`;

/** How many members of a big hash, list, set or stream are shown. */
export const MEMBER_LIMIT = 500;
const SCAN_COUNT = 500;
const MAX_KEY = 4096;
const MAX_VALUE = 1_000_000;

const SCAN_LUA = `
local r = redis.call('SCAN', ARGV[1], 'MATCH', ARGV[2], 'COUNT', tonumber(ARGV[3]))
local keys = {}
for i, k in ipairs(r[2]) do
  keys[i] = {k, redis.call('TYPE', k)['ok'], redis.call('PTTL', k)}
end
return cjson.encode({r[1], keys})
`;

// Big values are cut so one key can't fill the answer.
const GET_LUA = `
local k = KEYS[1]
local n = tonumber(ARGV[1])
local t = redis.call('TYPE', k)['ok']
local out = {type = t, ttl = redis.call('PTTL', k)}
local function scan(cmd, len)
  out.size = redis.call(len, k)
  local items, cursor = {}, '0'
  repeat
    local r = redis.call(cmd, k, cursor, 'COUNT', 200)
    cursor = r[1]
    for _, v in ipairs(r[2]) do items[#items + 1] = v end
  until cursor == '0' or #items >= n
  out.value = items
end
if t == 'string' then
  out.size = redis.call('STRLEN', k)
  out.value = redis.call('GETRANGE', k, 0, 1048575)
elseif t == 'hash' then
  scan('HSCAN', 'HLEN')
elseif t == 'set' then
  scan('SSCAN', 'SCARD')
elseif t == 'list' then
  out.size = redis.call('LLEN', k)
  out.value = redis.call('LRANGE', k, 0, n - 1)
elseif t == 'zset' then
  out.size = redis.call('ZCARD', k)
  out.value = redis.call('ZRANGE', k, 0, n - 1, 'WITHSCORES')
elseif t == 'stream' then
  out.size = redis.call('XLEN', k)
  out.value = redis.call('XREVRANGE', k, '+', '-', 'COUNT', n)
end
return cjson.encode(out)
`;

/** Commands a read only connection may run in the console. */
export const READ_COMMANDS = new Set([
  "ping",
  "echo",
  "info",
  "dbsize",
  "time",
  "lastsave",
  "role",
  "type",
  "ttl",
  "pttl",
  "expiretime",
  "pexpiretime",
  "exists",
  "keys",
  "scan",
  "randomkey",
  "get",
  "mget",
  "getrange",
  "strlen",
  "substr",
  "hget",
  "hmget",
  "hgetall",
  "hkeys",
  "hvals",
  "hlen",
  "hexists",
  "hstrlen",
  "hscan",
  "hrandfield",
  "lrange",
  "llen",
  "lindex",
  "lpos",
  "smembers",
  "scard",
  "sismember",
  "smismember",
  "srandmember",
  "sscan",
  "sinter",
  "sunion",
  "sdiff",
  "sintercard",
  "zrange",
  "zrangebyscore",
  "zrangebylex",
  "zrevrange",
  "zrevrangebyscore",
  "zrevrangebylex",
  "zcard",
  "zcount",
  "zlexcount",
  "zscore",
  "zmscore",
  "zrank",
  "zrevrank",
  "zscan",
  "zrandmember",
  "xrange",
  "xrevrange",
  "xlen",
  "xinfo",
  "xpending",
  "pfcount",
  "getbit",
  "bitcount",
  "bitpos",
  "object",
  "memory",
  "dump",
  "touch",
  "geopos",
  "geodist",
  "geohash",
  "georadius_ro",
  "georadiusbymember_ro",
  "geosearch",
  "json.get",
  "json.type",
  "json.objlen",
  "json.objkeys",
  "json.arrlen",
  "json.strlen",
  "slowlog",
  "latency",
  "command",
  "lolwut",
  "client",
  "config",
]);

/** Subcommands that change things, refused on a read only connection. */
const WRITE_SUBCOMMANDS: Record<string, Set<string>> = {
  client: new Set(["kill", "pause", "unpause", "setname", "no-evict", "reply"]),
  config: new Set(["set", "rewrite", "resetstat"]),
  memory: new Set(["purge"]),
  slowlog: new Set(["reset"]),
  latency: new Set(["reset"]),
};

/** Splits a console line the way redis-cli does: spaces, quotes and escapes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let word = "";
    const quote = line[i] === '"' || line[i] === "'" ? line[i] : "";
    if (quote) {
      i++;
      let closed = false;
      while (i < line.length) {
        const ch = line[i];
        if (ch === quote) {
          closed = true;
          i++;
          break;
        }
        if (ch === "\\" && quote === '"' && i + 1 < line.length) {
          const next = line[i + 1];
          const map: Record<string, string> = {
            n: "\n",
            r: "\r",
            t: "\t",
            '"': '"',
            "\\": "\\",
          };
          if (
            next === "x" &&
            /^[0-9a-fA-F]{2}$/.test(line.slice(i + 2, i + 4))
          ) {
            word += String.fromCharCode(parseInt(line.slice(i + 2, i + 4), 16));
            i += 4;
            continue;
          }
          word += map[next] ?? next;
          i += 2;
          continue;
        }
        if (ch === "\\" && quote === "'" && line[i + 1] === "'") {
          word += "'";
          i += 2;
          continue;
        }
        word += ch;
        i++;
      }
      if (!closed) throw new DatabasesError("A quote is not closed");
      if (i < line.length && !/\s/.test(line[i])) {
        throw new DatabasesError("Put a space after a closing quote");
      }
    } else {
      while (i < line.length && !/\s/.test(line[i])) word += line[i++];
    }
    out.push(word);
  }
  return out;
}

/** Why a read only connection may not run this, or null when it may. */
export function readOnlyRefusal(args: string[]): string | null {
  const command = (args[0] ?? "").toLowerCase();
  if (!READ_COMMANDS.has(command)) {
    return `${args[0]} changes data, and this connection is read only`;
  }
  const sub = (args[1] ?? "").toLowerCase();
  if (WRITE_SUBCOMMANDS[command]?.has(sub)) {
    return `${args[0]} ${args[1]} is not allowed on a read only connection`;
  }
  return null;
}

/** Commands that would take over the session or never end. */
const BLOCKED = new Set([
  "monitor",
  "subscribe",
  "psubscribe",
  "ssubscribe",
  "sync",
  "psync",
  "debug",
  "shutdown",
  "quit",
  "reset",
]);

export function dbIndex(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (text === "") return "";
  if (!/^\d{1,4}$/.test(text)) {
    throw new DatabasesError("The database number is not valid");
  }
  return text;
}

function checkKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new DatabasesError("The key is required");
  }
  if (key.length > MAX_KEY) throw new DatabasesError("The key is too long");
  return key;
}

function checkValue(value: unknown, label = "The value"): string {
  if (typeof value !== "string")
    throw new DatabasesError(`${label} is required`);
  if (value.length > MAX_VALUE)
    throw new DatabasesError(`${label} is too long`);
  return value;
}

/** The redis-cli arguments for a change made from the key view. */
export function writeArgs(write: RedisWrite): string[] {
  const key = checkKey(write.key);
  switch (write.op) {
    case "set":
      return ["SET", key, checkValue(write.value), "KEEPTTL"];
    case "delete":
      return ["UNLINK", key];
    case "rename":
      return ["RENAMENX", key, checkKey(write.newKey)];
    case "expire": {
      if (write.ttl === null || write.ttl === undefined)
        return ["PERSIST", key];
      const ttl = Number(write.ttl);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 315_360_000) {
        throw new DatabasesError(
          "The expiry must be a whole number of seconds",
        );
      }
      return ["EXPIRE", key, String(ttl)];
    }
    case "hset":
      return [
        "HSET",
        key,
        checkValue(write.field, "The field"),
        checkValue(write.value),
      ];
    case "hdel":
      return ["HDEL", key, checkValue(write.field, "The field")];
    case "rpush":
      return ["RPUSH", key, checkValue(write.value)];
    case "lset": {
      const index = Number(write.index);
      if (!Number.isInteger(index))
        throw new DatabasesError("The index is not valid");
      return ["LSET", key, String(index), checkValue(write.value)];
    }
    case "lrem":
      return ["LREM", key, "1", checkValue(write.value)];
    case "sadd":
      return ["SADD", key, checkValue(write.value)];
    case "srem":
      return ["SREM", key, checkValue(write.value)];
    case "zadd": {
      const score = Number(write.score);
      if (!Number.isFinite(score))
        throw new DatabasesError("The score is not a number");
      return ["ZADD", key, String(score), checkValue(write.value)];
    }
    case "zrem":
      return ["ZREM", key, checkValue(write.value)];
    default:
      throw new DatabasesError("Unknown change");
  }
}

/** The shell part every Redis script starts with. */
function prelude(conn: Conn, db: string): string[] {
  const lines = [
    'command -v redis-cli >/dev/null 2>&1 || { echo "DB_ERR:redis-cli is not installed on this host"; exit 127; }',
    setVar("DB_ADDR", conn.address),
    setVar("DB_PORT", conn.port ? String(conn.port) : ""),
    setVar("DB_USER", conn.username),
    setVar("DB_NAME", db || conn.database),
  ];
  if (conn.password) {
    lines.push(
      `export REDISCLI_AUTH="$(printf %s '${b64(conn.password)}' | base64 -d)"`,
    );
  }
  lines.push(
    "rcli() {",
    '  local a=(--no-auth-warning -h "${DB_ADDR:-127.0.0.1}" -p "${DB_PORT:-6379}" -n "${DB_NAME:-0}")',
    '  [ -n "$DB_USER" ] && a+=(--user "$DB_USER")',
    '  redis-cli "${a[@]}" "$@" </dev/null',
    "}",
    "args=()",
  );
  return lines;
}

function argLines(args: string[]): string[] {
  return args.map(
    (arg) =>
      `args+=("$(printf %s '${b64(arg)}' | base64 -d; printf x)"); args[-1]="\${args[-1]%x}"`,
  );
}

/** A script that runs Lua and prints its JSON, or DB_ERR lines. */
export function luaScript(
  conn: Conn,
  db: string,
  lua: string,
  keys: string[],
  argv: string[],
): string {
  return [
    ...prelude(conn, db),
    setVar("LUA", lua),
    ...argLines([...keys, ...argv]),
    `out="$(rcli --raw EVAL "$LUA" ${keys.length} "\${args[@]}" 2>&1)"`,
    'case "$out" in',
    "  '['*|'{'*) printf '%s\\n' \"$out\" ;;",
    "  *) printf '%s\\n' \"$out\" | sed 's/^/DB_ERR:/'; exit 1 ;;",
    "esac",
    "",
  ].join("\n");
}

/** A script that runs one command and prints redis-cli's own text. */
export function commandScript(conn: Conn, db: string, args: string[]): string {
  return [
    ...prelude(conn, db),
    ...argLines(args),
    'out="$(rcli --no-raw "${args[@]}" 2>&1)"',
    "rc=$?",
    'case "$out" in',
    "  '(error)'*|'AUTH failed'*|'Could not connect'*) printf '%s\\n' \"$out\" | sed 's/^(error) //; s/^/DB_ERR:/'; exit 1 ;;",
    "esac",
    "printf '%s\\n' \"$out\"",
    'exit "$rc"',
    "",
  ].join("\n");
}

function parseJson<T>(output: string): T {
  try {
    return JSON.parse(output.trim()) as T;
  } catch {
    throw new DatabasesError("Redis sent an answer that could not be read");
  }
}

/** cjson writes an empty table as {}, so treat that as an empty list. */
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function parseKeyPage(output: string): RedisKeyPage {
  const [cursor, keys] = parseJson<[string, unknown]>(output);
  return {
    cursor: String(cursor),
    keys: list(keys).map((entry) => {
      const [key, type, ttl] = list(entry) as [string, string, number];
      return {
        key: String(key),
        type: String(type),
        ttl: Number(ttl),
      } satisfies RedisKey;
    }),
  };
}

export function parseValue(output: string): RedisValue {
  const raw = parseJson<Record<string, unknown>>(output);
  const type = String(raw.type ?? "none");
  const size = Number(raw.size ?? 0);
  const ttl = Number(raw.ttl ?? -2);
  const values = list(raw.value).map(String);
  const base = { type, ttl, size };
  switch (type) {
    case "string": {
      const value = typeof raw.value === "string" ? raw.value : "";
      return { ...base, value, truncated: value.length < size };
    }
    case "hash": {
      const fields: Array<{ field: string; value: string }> = [];
      for (let i = 0; i + 1 < values.length; i += 2) {
        fields.push({ field: values[i], value: values[i + 1] });
      }
      return { ...base, fields, truncated: fields.length < size };
    }
    case "list":
    case "set":
      return { ...base, items: values, truncated: values.length < size };
    case "zset": {
      const members: Array<{ member: string; score: string }> = [];
      for (let i = 0; i + 1 < values.length; i += 2) {
        members.push({ member: values[i], score: values[i + 1] });
      }
      return { ...base, members, truncated: members.length < size };
    }
    case "stream": {
      const entries = list(raw.value).map((entry) => {
        const [id, pairs] = list(entry) as [string, unknown];
        const flat = list(pairs).map(String);
        const fields: Record<string, string> = {};
        for (let i = 0; i + 1 < flat.length; i += 2)
          fields[flat[i]] = flat[i + 1];
        return { id: String(id), fields };
      });
      return { ...base, entries, truncated: entries.length < size };
    }
    default:
      return { ...base, type: "none" };
  }
}

export function parseInfo(output: string): RedisInfo {
  const info: RedisInfo = { version: "", databases: [] };
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const version = /^(?:redis|valkey)_version:(.+)$/.exec(line);
    if (version && !info.version) info.version = version[1];
    const db = /^db(\d+):keys=(\d+)/.exec(line);
    if (db) info.databases.push({ index: Number(db[1]), keys: Number(db[2]) });
  }
  return info;
}

export function createRedis(remote: Remote) {
  const run = (hostId: number, conn: Conn, script: string) =>
    remote.run(hostId, conn.runAs, script);

  return {
    async info(hostId: number, conn: Conn): Promise<RedisInfo> {
      const output = await run(hostId, conn, commandScript(conn, "", ["INFO"]));
      return parseInfo(output);
    },

    async version(hostId: number, conn: Conn): Promise<string> {
      const info = parseInfo(
        await run(hostId, conn, commandScript(conn, "", ["INFO", "server"])),
      );
      return info.version ? `Redis ${info.version}` : "Redis";
    },

    async keys(
      hostId: number,
      conn: Conn,
      db: string,
      pattern: string,
      cursor: string,
    ): Promise<RedisKeyPage> {
      if (!/^\d{1,20}$/.test(cursor))
        throw new DatabasesError("The cursor is not valid");
      if (pattern.length > 512)
        throw new DatabasesError("The pattern is too long");
      const output = await run(
        hostId,
        conn,
        luaScript(
          conn,
          db,
          SCAN_LUA,
          [],
          [cursor, pattern || "*", String(SCAN_COUNT)],
        ),
      );
      return parseKeyPage(output);
    },

    async value(
      hostId: number,
      conn: Conn,
      db: string,
      key: string,
    ): Promise<RedisValue> {
      const output = await run(
        hostId,
        conn,
        luaScript(conn, db, GET_LUA, [checkKey(key)], [String(MEMBER_LIMIT)]),
      );
      return parseValue(output);
    },

    async write(
      hostId: number,
      conn: Conn,
      db: string,
      write: RedisWrite,
    ): Promise<{ output: string }> {
      const output = await run(
        hostId,
        conn,
        commandScript(conn, db, writeArgs(write)),
      );
      return { output: output.trim() };
    },

    async console(
      hostId: number,
      conn: Conn,
      db: string,
      line: string,
      readOnly: boolean,
    ): Promise<{ output: string; readOnly: boolean }> {
      if (line.length > MAX_VALUE)
        throw new DatabasesError("The command is too long");
      const args = splitCommand(line.trim());
      if (args.length === 0) throw new DatabasesError("Enter a command");
      if (BLOCKED.has(args[0].toLowerCase())) {
        throw new DatabasesError(`${args[0]} can't run here`);
      }
      if (readOnly) {
        const refusal = readOnlyRefusal(args);
        if (refusal) throw new DatabasesError(refusal, 403);
      }
      const output = await run(hostId, conn, commandScript(conn, db, args));
      return { output: output.replace(/\n$/, ""), readOnly };
    },
  };
}

export type RedisService = ReturnType<typeof createRedis>;
