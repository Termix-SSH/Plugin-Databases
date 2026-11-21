import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Database, KeyRound, Pencil, Play, Trash2 } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  BackButton,
  Button,
  FormFooter,
  InlineView,
  Input,
  ListBadge,
  ListRow,
  ListRowAction,
  LoadingState,
  PanelList,
  PanelSearch,
  PanelShell,
  Segmented,
  SelectField,
  TOOLBAR_FIT,
  TextAreaField,
  TextField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type {
  ConnectionView,
  RedisKey,
  RedisValue,
  RedisWrite,
} from "../shared/types";
import {
  errorMessage,
  listDatabases,
  redisConsole,
  redisKeys,
  redisValue,
  redisWrite,
} from "./api";

type Mode = "keys" | "console";
type NewType = "string" | "hash" | "list" | "set" | "zset";

/** "1h 5m" style text for a TTL in milliseconds. */
export function ttlText(ms: number): string {
  if (ms < 0) return "";
  let s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, !d && !h && s && `${s}s`]
    .filter(Boolean)
    .join(" ");
}

/** Keys and values of one Redis login, plus a command console. */
export function RedisBrowser({
  hostId,
  connection,
  onBack,
}: {
  hostId: number;
  connection: ConnectionView;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("keys");
  const [databases, setDatabases] = useState<string[]>([]);
  const [db, setDb] = useState(connection.database || "0");

  useEffect(() => {
    listDatabases(hostId, connection.id)
      .then((list) => {
        const all = new Set([...list, connection.database || "0"]);
        setDatabases(
          [...all].sort((a, b) => Number(a) - Number(b)).filter(Boolean),
        );
      })
      .catch(() => setDatabases([connection.database || "0"]));
  }, [hostId, connection.id, connection.database]);

  return (
    <PanelShell
      icon={<Database className="size-4" />}
      leading={<BackButton onClick={onBack} />}
      title={connection.name}
      status={`${t("conn.engine.redis")} | ${t("redis.db", { db })}`}
      toolbar={
        <>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "keys", label: t("redis.keys") },
              { value: "console", label: t("redis.console") },
            ]}
          />
          {databases.length > 1 && (
            <SelectField
              label={t("redis.database")}
              value={db}
              onChange={setDb}
              options={databases.map((value) => ({
                value,
                label: t("redis.db", { db: value }),
              }))}
            />
          )}
        </>
      }
    >
      {mode === "keys" ? (
        <KeysView key={db} hostId={hostId} connection={connection} db={db} />
      ) : (
        <RedisConsole hostId={hostId} connection={connection} db={db} />
      )}
    </PanelShell>
  );
}

function KeysView({
  hostId,
  connection,
  db,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pattern, setPattern] = useState("");
  const [applied, setApplied] = useState("*");
  const [keys, setKeys] = useState<RedisKey[] | null>(null);
  const [cursor, setCursor] = useState("0");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const writable = !connection.readOnly;

  const load = useCallback(
    async (from: string, append: boolean) => {
      setLoading(true);
      try {
        const page = await redisKeys(hostId, connection.id, db, applied, from);
        setKeys((current) =>
          append && current ? [...current, ...page.keys] : page.keys,
        );
        setCursor(page.cursor);
      } catch (e) {
        toast.error(errorMessage(e, t("redis.loadFailed")));
        if (!append) setKeys([]);
      } finally {
        setLoading(false);
      }
    },
    [hostId, connection.id, db, applied, toast, t],
  );

  useEffect(() => {
    setKeys(null);
    void load("0", false);
  }, [load]);

  const search = () => {
    const next = pattern.trim();
    setApplied(next ? (/[*?[]/.test(next) ? next : `*${next}*`) : "*");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-b border-border md:max-h-none md:w-72 md:border-b-0 md:border-r">
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
        >
          <PanelSearch
            className="w-full md:w-full"
            value={pattern}
            onChange={setPattern}
            placeholder={t("redis.pattern")}
          />
          {writable && (
            <AddButton
              label={t("redis.newKey")}
              onClick={() => setCreating(true)}
            />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {keys === null ? (
            <LoadingState label={t("redis.loading")} />
          ) : (
            <PanelList
              empty={
                <p className="p-3 text-xs text-muted-foreground">
                  {t("redis.noKeys")}
                </p>
              }
            >
              {keys.map((entry, index) => (
                <ListRow
                  key={`${entry.key}\u0000${index}`}
                  stripe={index}
                  icon={<KeyRound className="size-4" />}
                  title={entry.key}
                  selected={selected === entry.key}
                  onClick={() => setSelected(entry.key)}
                  badges={<ListBadge>{entry.type}</ListBadge>}
                  meta={entry.ttl > 0 ? ttlText(entry.ttl) : undefined}
                />
              ))}
            </PanelList>
          )}
          {cursor !== "0" && keys && (
            <div className="p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loading}
                onClick={() => void load(cursor, true)}
              >
                {t("redis.more")}
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <KeyView
            key={selected}
            hostId={hostId}
            connection={connection}
            db={db}
            name={selected}
            onGone={() => {
              setSelected(null);
              void load("0", false);
            }}
            onRenamed={(next) => {
              setSelected(next);
              void load("0", false);
            }}
          />
        ) : (
          <p className="p-3 text-xs text-muted-foreground">{t("redis.pick")}</p>
        )}
      </div>
      {creating && (
        <NewKey
          hostId={hostId}
          connection={connection}
          db={db}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            setSelected(name);
            void load("0", false);
          }}
        />
      )}
    </div>
  );
}

function KeyView({
  hostId,
  connection,
  db,
  name,
  onGone,
  onRenamed,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
  name: string;
  onGone: () => void;
  onRenamed: (name: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [value, setValue] = useState<RedisValue | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"rename" | "ttl" | "member" | null>(
    null,
  );
  const writable = !connection.readOnly;

  const load = useCallback(async () => {
    try {
      const next = await redisValue(hostId, connection.id, db, name);
      setValue(next);
      setText(next.value ?? "");
    } catch (e) {
      toast.error(errorMessage(e, t("redis.loadFailed")));
    }
  }, [hostId, connection.id, db, name, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const write = async (change: Omit<RedisWrite, "key">, done?: string) => {
    setBusy(true);
    try {
      await redisWrite(hostId, connection.id, db, { key: name, ...change });
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, t("redis.writeFailed")));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("redis.deleteTitle", { key: name }),
      confirmLabel: t("common.delete"),
    });
    if (ok && (await write({ op: "delete" }, t("redis.deleted")))) onGone();
  };

  const removeMember = async (change: Omit<RedisWrite, "key">) => {
    if (await write(change)) void load();
  };

  if (!value) return <LoadingState label={t("redis.loading")} />;
  if (value.type === "none") {
    return (
      <p className="p-3 text-xs text-muted-foreground">{t("redis.gone")}</p>
    );
  }

  const memberRows: Array<{
    id: string;
    label: string;
    meta?: string;
    remove?: Omit<RedisWrite, "key">;
  }> =
    value.type === "hash"
      ? (value.fields ?? []).map((f) => ({
          id: f.field,
          label: f.field,
          meta: f.value,
          remove: { op: "hdel", field: f.field },
        }))
      : value.type === "list"
        ? (value.items ?? []).map((item, index) => ({
            id: String(index),
            label: item,
            meta: `#${index}`,
            remove: { op: "lrem", value: item },
          }))
        : value.type === "set"
          ? (value.items ?? []).map((item) => ({
              id: item,
              label: item,
              remove: { op: "srem", value: item },
            }))
          : value.type === "zset"
            ? (value.members ?? []).map((m) => ({
                id: m.member,
                label: m.member,
                meta: m.score,
                remove: { op: "zrem", value: m.member },
              }))
            : (value.entries ?? []).map((entry) => ({
                id: entry.id,
                label: entry.id,
                meta: Object.entries(entry.fields)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" "),
              }));

  return (
    <>
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
      >
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={name}
        >
          {name}
        </span>
        <ListBadge>{value.type}</ListBadge>
        <span className="text-xs text-muted-foreground">
          {t("redis.size", { count: value.size })}
          {value.ttl > 0
            ? ` | ${t("redis.ttl", { ttl: ttlText(value.ttl) })}`
            : ""}
        </span>
        {writable && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog("rename")}
            >
              <Pencil className="size-3.5" />
              {t("redis.rename")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialog("ttl")}
            >
              <Clock className="size-3.5" />
              {t("redis.expire")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void remove()}
              disabled={busy}
            >
              <Trash2 className="size-3.5" />
              {t("common.delete")}
            </Button>
          </>
        )}
      </div>
      {value.truncated && (
        <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {t("redis.truncated")}
        </p>
      )}
      {value.type === "string" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <TextAreaField
            label={t("redis.value")}
            value={text}
            onChange={setText}
            mono
            fill
            disabled={!writable || value.truncated}
          />
          {writable && !value.truncated && (
            <div>
              <Button
                disabled={busy || text === (value.value ?? "")}
                onClick={() =>
                  void write({ op: "set", value: text }, t("redis.saved")).then(
                    (ok) => ok && void load(),
                  )
                }
              >
                {t("common.save")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {writable && value.type !== "stream" && (
            <div className="border-b border-border p-2">
              <AddButton
                label={t(`redis.add.${value.type}`)}
                onClick={() => setDialog("member")}
              />
            </div>
          )}
          <PanelList>
            {memberRows.map((row, index) => (
              <ListRow
                key={`${row.id}\u0000${index}`}
                stripe={index}
                title={row.label}
                meta={row.meta}
                actions={
                  writable && row.remove ? (
                    <ListRowAction
                      label={t("common.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeMember(row.remove!);
                      }}
                    >
                      <Trash2 />
                    </ListRowAction>
                  ) : undefined
                }
              />
            ))}
          </PanelList>
        </div>
      )}
      {dialog && (
        <KeyDialog
          kind={dialog}
          type={value.type}
          busy={busy}
          onClose={() => setDialog(null)}
          onSave={async (input) => {
            let ok = false;
            if (dialog === "rename") {
              ok = await write({ op: "rename", newKey: input.a });
              if (ok) onRenamed(input.a);
            } else if (dialog === "ttl") {
              ok = await write({
                op: "expire",
                ttl: input.a.trim() ? Number(input.a) : null,
              });
            } else if (value.type === "hash") {
              ok = await write({ op: "hset", field: input.a, value: input.b });
            } else if (value.type === "list") {
              ok = await write({ op: "rpush", value: input.a });
            } else if (value.type === "set") {
              ok = await write({ op: "sadd", value: input.a });
            } else if (value.type === "zset") {
              ok = await write({
                op: "zadd",
                value: input.a,
                score: Number(input.b),
              });
            }
            if (ok) {
              setDialog(null);
              if (dialog !== "rename") void load();
            }
          }}
        />
      )}
    </>
  );
}

function KeyDialog({
  kind,
  type,
  busy,
  onClose,
  onSave,
}: {
  kind: "rename" | "ttl" | "member";
  type: string;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { a: string; b: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const second = kind === "member" && (type === "hash" || type === "zset");
  const firstLabel =
    kind === "rename"
      ? t("redis.newName")
      : kind === "ttl"
        ? t("redis.ttlSeconds")
        : type === "hash"
          ? t("redis.field")
          : t("redis.value");
  const valid =
    kind === "ttl"
      ? !a.trim() || /^\d+$/.test(a.trim())
      : a.length > 0 &&
        (!second || type !== "zset" || Number.isFinite(Number(b)));
  return (
    <InlineView
      open
      onOpenChange={(next) => !next && onClose()}
      title={
        kind === "rename"
          ? t("redis.rename")
          : kind === "ttl"
            ? t("redis.expire")
            : t(`redis.add.${type}`)
      }
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={() => void onSave({ a, b })}
          saving={busy}
          disabled={!valid}
          cancelLabel={t("common.cancel")}
          saveLabel={t("common.save")}
        />
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <TextField
          label={firstLabel}
          hint={kind === "ttl" ? t("redis.ttlHint") : undefined}
          value={a}
          onChange={setA}
          mono
        />
        {second && (
          <TextField
            label={type === "zset" ? t("redis.score") : t("redis.value")}
            value={b}
            onChange={setB}
            mono
          />
        )}
      </div>
    </InlineView>
  );
}

function NewKey({
  hostId,
  connection,
  db,
  onClose,
  onCreated,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<NewType>("string");
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const change: RedisWrite =
      type === "string"
        ? { op: "set", key: name, value }
        : type === "hash"
          ? { op: "hset", key: name, field: extra, value }
          : type === "list"
            ? { op: "rpush", key: name, value }
            : type === "set"
              ? { op: "sadd", key: name, value }
              : { op: "zadd", key: name, value, score: Number(extra) || 0 };
    setBusy(true);
    try {
      await redisWrite(hostId, connection.id, db, change);
      onCreated(name);
    } catch (e) {
      toast.error(errorMessage(e, t("redis.writeFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <InlineView
      open
      onOpenChange={(next) => !next && onClose()}
      title={t("redis.newKey")}
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={() => void create()}
          saving={busy}
          disabled={!name || (type === "hash" && !extra)}
          cancelLabel={t("common.cancel")}
          saveLabel={t("common.save")}
        />
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <TextField
          label={t("redis.keyName")}
          value={name}
          onChange={setName}
          mono
        />
        <SelectField<NewType>
          label={t("redis.type")}
          value={type}
          onChange={setType}
          options={(["string", "hash", "list", "set", "zset"] as const).map(
            (value) => ({ value, label: t(`redis.types.${value}`) }),
          )}
        />
        {(type === "hash" || type === "zset") && (
          <TextField
            label={type === "hash" ? t("redis.field") : t("redis.score")}
            value={extra}
            onChange={setExtra}
            mono
          />
        )}
        <TextAreaField
          label={type === "zset" ? t("redis.member") : t("redis.value")}
          value={value}
          onChange={setValue}
          rows={4}
          mono
        />
      </div>
    </InlineView>
  );
}

interface ConsoleEntry {
  line: string;
  output: string;
  error: boolean;
}

function RedisConsole({
  hostId,
  connection,
  db,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
}) {
  const { t } = useTranslation();
  const [line, setLine] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [readOnly, setReadOnly] = useState(connection.readOnly);
  const history = useRef<string[]>([]);
  const position = useRef(-1);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries]);

  const run = async () => {
    const command = line.trim();
    if (!command) return;
    history.current = [command, ...history.current].slice(0, 100);
    position.current = -1;
    setLine("");
    setRunning(true);
    try {
      const result = await redisConsole(hostId, connection.id, db, command);
      setReadOnly(result.readOnly);
      setEntries((current) => [
        ...current,
        { line: command, output: result.output, error: false },
      ]);
    } catch (e) {
      setEntries((current) => [
        ...current,
        {
          line: command,
          output: errorMessage(e, t("redis.writeFailed")),
          error: true,
        },
      ]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
        {entries.length === 0 && (
          <p className="text-muted-foreground">
            {readOnly ? t("redis.consoleReadOnly") : t("redis.consoleHint")}
          </p>
        )}
        {entries.map((entry, index) => (
          <div key={index} className="mb-2">
            <div className="text-accent-brand">
              {`db${db}> `}
              {entry.line}
            </div>
            <pre
              className={`whitespace-pre-wrap break-all ${entry.error ? "text-destructive" : ""}`}
            >
              {entry.output}
            </pre>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div
        className={`flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 ${TOOLBAR_FIT}`}
      >
        <Input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const next = position.current + (e.key === "ArrowUp" ? 1 : -1);
              if (next < -1 || next >= history.current.length) return;
              position.current = next;
              setLine(next === -1 ? "" : history.current[next]);
            }
          }}
          placeholder={t("redis.commandPlaceholder")}
          className="font-mono text-xs"
          spellCheck={false}
          disabled={running}
        />
        <Button onClick={() => void run()} disabled={running || !line.trim()}>
          <Play className="size-3.5" />
          {t("sql.run")}
        </Button>
      </div>
    </div>
  );
}
