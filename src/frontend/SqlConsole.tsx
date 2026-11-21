import { useEffect, useState } from "react";
import { CopyPlus, Play, Save, X } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, ListBadge, TextAreaField } from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, QueryResult, ResultSet } from "../shared/types";
import { errorMessage, runQuery } from "./api";
import { download, toCsv, toJson } from "./exportGrid";
import { GridTable } from "./GridTable";

const HISTORY_MAX = 15;

function loadHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function saveHistory(key: string, items: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage can be blocked. The console works without history.
  }
}

export interface SavedScript {
  name: string;
  sql: string;
}

const SCRIPTS_MAX = 50;

function loadScripts(key: string): SavedScript[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is SavedScript =>
            !!item &&
            typeof item.name === "string" &&
            typeof item.sql === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveScripts(key: string, items: SavedScript[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage can be blocked. Scripts then last until the console closes.
  }
}

/** A script's name: its first line, without a leading SQL comment mark. */
export function scriptName(sql: string): string {
  const first = sql.trim().split("\n")[0] ?? "";
  return (
    first
      .replace(/^--\s*/, "")
      .trim()
      .slice(0, 60) || "SQL"
  );
}

/** A unique name, adding a number when it is taken. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const next = `${name} (${n})`;
    if (!taken.includes(next)) return next;
  }
}

/** Puts text into the editor, after what is there with a space. */
export function appendSql(current: string, text: string): string {
  if (!current) return text;
  return /\s$/.test(current) ? current + text : `${current} ${text}`;
}

/** Text the browser asks the console to add or load. */
export interface SqlInsert {
  text: string;
  replace: boolean;
  /** Changes on every request, so the same text can be added twice. */
  n: number;
}

function ResultBlock({
  set,
  title,
}: {
  set: Pick<ResultSet, "columns" | "rows"> & { truncated?: boolean };
  /** Shown above each of several results, which then get a set height. */
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={
        title
          ? "flex max-h-[28rem] shrink-0 flex-col gap-1"
          : "flex min-h-0 flex-1 flex-col gap-1"
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {title && (
          <span
            className="max-w-96 truncate font-mono text-foreground"
            title={title}
          >
            {title.replace(/\s+/g, " ")}
          </span>
        )}
        <span>{t("data.rowCount", { count: set.rows.length })}</span>
        {set.truncated && (
          <span>{t("sql.truncated", { count: set.rows.length })}</span>
        )}
        {set.columns.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                download("result.csv", toCsv(set.columns, set.rows), "text/csv")
              }
            >
              CSV
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                download(
                  "result.json",
                  toJson(set.columns, set.rows),
                  "application/json",
                )
              }
            >
              JSON
            </Button>
          </>
        )}
      </div>
      {set.columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sql.noResult")}</p>
      ) : (
        <GridTable columns={set.columns} rows={set.rows} />
      )}
    </div>
  );
}

/** Free SQL. Runs read only unless the host and the login allow changes. */
export function SqlConsole({
  hostId,
  connection,
  db,
  insert,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
  insert?: SqlInsert | null;
}) {
  const { t } = useTranslation();
  const historyKey = `databases.history.${hostId}.${connection.id}`;
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>(() =>
    loadHistory(historyKey),
  );
  const scriptsKey = `databases.scripts.${hostId}.${connection.id}`;
  const [scripts, setScripts] = useState<SavedScript[]>(() =>
    loadScripts(scriptsKey),
  );
  // The saved script in the editor, so Save changes it in place.
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!insert) return;
    if (insert.replace) {
      setSql(insert.text);
      setCurrent(null);
    } else {
      setSql((text) => appendSql(text, insert.text));
    }
  }, [insert]);

  const updateScripts = (next: SavedScript[]) => {
    setScripts(next);
    saveScripts(scriptsKey, next);
  };

  const saveScript = (asNew: boolean) => {
    const text = sql.trim();
    if (!text) return;
    const existing = !asNew && current !== null;
    const others = scripts.filter((item) => item.name !== current);
    const name = existing
      ? current!
      : uniqueName(
          scriptName(text),
          scripts.map((item) => item.name),
        );
    updateScripts(
      [{ name, sql: text }, ...(existing ? others : scripts)].slice(
        0,
        SCRIPTS_MAX,
      ),
    );
    setCurrent(name);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory(historyKey, []);
  };

  const run = async () => {
    const text = sql.trim();
    if (!text || running) return;
    setRunning(true);
    setError("");
    try {
      setResult(await runQuery(hostId, connection.id, db, text));
      const next = [text, ...history.filter((item) => item !== text)].slice(
        0,
        HISTORY_MAX,
      );
      setHistory(next);
      saveHistory(historyKey, next);
    } catch (e) {
      setResult(null);
      setError(errorMessage(e, t("sql.failed")));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void run();
        }
      }}
    >
      <TextAreaField
        label={current ? t("sql.editing", { name: current }) : t("sql.label")}
        value={sql}
        onChange={setSql}
        placeholder={t("sql.placeholder")}
        rows={6}
        mono
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button onClick={() => void run()} disabled={running || !sql.trim()}>
          <Play className="size-3.5" />
          {running ? t("sql.running") : t("sql.run")}
        </Button>
        <Button
          variant="outline"
          onClick={() => saveScript(false)}
          disabled={!sql.trim()}
          title={t("sql.saveHint")}
        >
          <Save className="size-3.5" />
          {t("sql.save")}
        </Button>
        {current && (
          <Button
            variant="outline"
            onClick={() => saveScript(true)}
            disabled={!sql.trim()}
          >
            <CopyPlus className="size-3.5" />
            {t("sql.saveAsNew")}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{t("sql.hint")}</span>
      </div>
      {scripts.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {t("sql.saved")}
          </span>
          {scripts.map((item) => (
            <span key={item.name} className="inline-flex items-center">
              <Button
                variant={item.name === current ? "default" : "outline"}
                size="xs"
                className="max-w-48 truncate"
                title={item.sql}
                onClick={() => {
                  setSql(item.sql);
                  setCurrent(item.name);
                }}
              >
                {item.name}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label={t("sql.removeScript", { name: item.name })}
                onClick={() => {
                  updateScripts(scripts.filter((other) => other !== item));
                  if (current === item.name) setCurrent(null);
                }}
              >
                <X className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {t("sql.history")}
          </span>
          {history.slice(0, 5).map((item) => (
            <Button
              key={item}
              variant="outline"
              size="xs"
              className="max-w-48 truncate font-mono"
              title={item}
              onClick={() => {
                setSql(item);
                setCurrent(null);
              }}
            >
              {item.replace(/\s+/g, " ").slice(0, 40)}
            </Button>
          ))}
          <Button variant="ghost" size="xs" onClick={clearHistory}>
            {t("sql.clearHistory")}
          </Button>
        </div>
      )}
      {error && (
        <pre className="shrink-0 whitespace-pre-wrap border border-border p-2 text-xs text-destructive">
          {error}
        </pre>
      )}
      {result && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("sql.elapsed", { ms: result.elapsedMs })}</span>
            {result.sets && (
              <span>{t("sql.results", { count: result.sets.length })}</span>
            )}
            {result.readOnly && (
              <ListBadge tone="warning">{t("sql.readOnlySession")}</ListBadge>
            )}
          </div>
          {result.sets ? (
            result.sets.map((set, index) => (
              <ResultBlock key={index} set={set} title={set.statement} />
            ))
          ) : (
            <ResultBlock set={result} />
          )}
        </>
      )}
    </div>
  );
}
