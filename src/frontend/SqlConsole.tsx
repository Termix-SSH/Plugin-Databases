import { useState } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, ListBadge, TextAreaField } from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, QueryResult } from "../shared/types";
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

/** Free SQL. Runs read only unless the host and the login allow changes. */
export function SqlConsole({
  hostId,
  connection,
  db,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
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
      className="flex min-h-0 flex-1 flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void run();
        }
      }}
    >
      <TextAreaField
        label={t("sql.label")}
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
        <span className="text-xs text-muted-foreground">{t("sql.hint")}</span>
      </div>
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
              onClick={() => setSql(item)}
            >
              {item.replace(/\s+/g, " ").slice(0, 40)}
            </Button>
          ))}
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
            <span>{t("data.rowCount", { count: result.rows.length })}</span>
            {result.readOnly && (
              <ListBadge tone="warning">{t("sql.readOnlySession")}</ListBadge>
            )}
            {result.truncated && (
              <span>{t("sql.truncated", { count: result.rows.length })}</span>
            )}
            {result.columns.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    download(
                      "result.csv",
                      toCsv(result.columns, result.rows),
                      "text/csv",
                    )
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
                      toJson(result.columns, result.rows),
                      "application/json",
                    )
                  }
                >
                  JSON
                </Button>
              </>
            )}
          </div>
          {result.columns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("sql.noResult")}</p>
          ) : (
            <GridTable columns={result.columns} rows={result.rows} />
          )}
        </>
      )}
    </div>
  );
}
