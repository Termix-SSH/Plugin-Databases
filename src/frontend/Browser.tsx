import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, Copy, Database, Eye, PencilLine, Table2 } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  BackButton,
  Button,
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
  PanelShell,
  Segmented,
  SelectField,
  TOOLBAR_FIT,
  copyToClipboard,
} from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, RoutineEntry, TableEntry } from "../shared/types";
import {
  errorMessage,
  listDatabases,
  listRoutines,
  listTables,
  runQuery,
} from "./api";
import { DataGrid } from "./DataGrid";
import { MongoBrowser } from "./MongoBrowser";
import { RedisBrowser } from "./RedisBrowser";
import { SqlConsole, type SqlInsert } from "./SqlConsole";
import { StructureView } from "./StructureView";

type Mode = "tables" | "routines" | "sql";
type Pane = "data" | "structure";

const WIDTH_KEY = "databases.listWidth";
const MIN_WIDTH = 180;
const MAX_WIDTH = 640;

function loadWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(value) && value >= MIN_WIDTH) {
      return Math.min(MAX_WIDTH, value);
    }
  } catch {
    // Storage can be blocked.
  }
  return 240;
}

const tableKey = (entry: TableEntry) => `${entry.schema}.${entry.name}`;

/**
 * SQL that recreates a routine, to change it in the console. MySQL needs
 * DROP and CREATE with its own delimiter, Postgres has CREATE OR REPLACE.
 */
export function routineScript(
  engine: string,
  routine: RoutineEntry,
  create: string,
): string {
  // SQL Server keeps the CREATE text; CREATE OR ALTER makes it runnable again.
  if (engine === "mssql") {
    return create.replace(
      /^(\s*(?:--[^\n]*\n\s*)*)CREATE\s+(PROC(?:EDURE)?|FUNCTION)\b/i,
      "$1CREATE OR ALTER $2",
    );
  }
  if (engine !== "mysql") return create;
  const kind = routine.kind === "procedure" ? "PROCEDURE" : "FUNCTION";
  const name = `\`${routine.name.replace(/`/g, "``")}\``;
  return `DROP ${kind} IF EXISTS ${name};\nDELIMITER //\n${create}//\nDELIMITER ;\n`;
}

/** The browser for one login, by the kind of database it is. */
export function Browser(props: {
  hostId: number;
  connection: ConnectionView;
  isVisible: boolean;
  onBack: () => void;
}) {
  if (props.connection.engine === "redis") return <RedisBrowser {...props} />;
  if (props.connection.engine === "mongo") return <MongoBrowser {...props} />;
  return <SqlBrowser {...props} />;
}

/** The tables of one login on the left, and the chosen table or SQL on the right. */
function SqlBrowser({
  hostId,
  connection,
  isVisible,
  onBack,
}: {
  hostId: number;
  connection: ConnectionView;
  isVisible: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [db, setDb] = useState("");
  const [tables, setTables] = useState<TableEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TableEntry | null>(null);
  const [routines, setRoutines] = useState<RoutineEntry[] | null>(null);
  const [routine, setRoutine] = useState<RoutineEntry | null>(null);
  const [mode, setModeState] = useState<Mode>("tables");
  const [pane, setPane] = useState<Pane>("data");
  const [error, setError] = useState("");
  const [width, setWidth] = useState(loadWidth);
  const [exact, setExact] = useState<Record<string, number>>({});
  const [insert, setInsert] = useState<SqlInsert | null>(null);
  const [opening, setOpening] = useState(false);
  const counter = useRef(0);

  const setMode = (next: Mode) => {
    if (next !== "sql") setInsert(null);
    setModeState(next);
  };

  const sendToSql = (text: string, replace: boolean) => {
    counter.current += 1;
    setInsert({ text, replace, n: counter.current });
  };

  useEffect(() => {
    if (!isVisible || databases) return;
    let live = true;
    listDatabases(hostId, connection.id)
      .then((names) => {
        if (!live) return;
        setDatabases(names);
        setDb(
          names.includes(connection.database)
            ? connection.database
            : (names[0] ?? ""),
        );
      })
      .catch((e) => {
        if (live) setError(errorMessage(e, t("browse.loadFailed")));
      });
    return () => {
      live = false;
    };
  }, [isVisible, databases, hostId, connection.id, connection.database, t]);

  useEffect(() => {
    if (databases === null) return;
    let live = true;
    setTables(null);
    setSelected(null);
    setExact({});
    listTables(hostId, connection.id, db)
      .then((list) => {
        if (live) setTables(list);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e, t("browse.loadFailed")));
      });
    return () => {
      live = false;
    };
  }, [databases, db, hostId, connection.id, t]);

  useEffect(() => {
    if (databases === null || mode !== "routines") return;
    let live = true;
    setRoutines(null);
    setRoutine(null);
    listRoutines(hostId, connection.id, db)
      .then((list) => {
        if (live) setRoutines(list);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e, t("browse.loadFailed")));
      });
    return () => {
      live = false;
    };
  }, [databases, db, mode, hostId, connection.id, t]);

  const visibleRoutines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (routines ?? []).filter(
      (entry) => !needle || entry.name.toLowerCase().includes(needle),
    );
  }, [routines, search]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (tables ?? []).filter(
      (entry) => !needle || entry.name.toLowerCase().includes(needle),
    );
  }, [tables, search]);

  const multiSchema = useMemo(
    () => new Set((tables ?? []).map((entry) => entry.schema)).size > 1,
    [tables],
  );

  const nameOf = (entry: TableEntry) =>
    multiSchema ? `${entry.schema}.${entry.name}` : entry.name;

  const copyName = async (entry: TableEntry) => {
    const name = nameOf(entry);
    try {
      await copyToClipboard(name);
      toast.success(t("browse.copied", { name }));
    } catch {
      toast.error(name);
    }
  };

  const onTotal = useCallback((entry: TableEntry, total: number) => {
    setExact((prev) =>
      prev[tableKey(entry)] === total
        ? prev
        : { ...prev, [tableKey(entry)]: total },
    );
  }, []);

  // MySQL and Postgres keep estimates, SQLite gives none.
  const rowsMeta = (entry: TableEntry) => {
    const known = exact[tableKey(entry)];
    if (known !== undefined) {
      return <span>{t("browse.rows", { count: known })}</span>;
    }
    if (entry.rows === null) return undefined;
    return (
      <span title={t("browse.rowsAboutHint")}>
        {t("browse.rowsAbout", { count: entry.rows })}
      </span>
    );
  };

  const openRoutineInSql = async (entry: RoutineEntry) => {
    setOpening(true);
    try {
      let create = entry.definition ?? "";
      if (connection.engine === "mysql") {
        const kind = entry.kind === "procedure" ? "PROCEDURE" : "FUNCTION";
        const q = (name: string) => `\`${name.replace(/`/g, "``")}\``;
        const res = await runQuery(
          hostId,
          connection.id,
          db,
          `SHOW CREATE ${kind} ${q(entry.schema)}.${q(entry.name)}`,
        );
        const column = res.columns.findIndex((c) => c.startsWith("Create "));
        create = (column >= 0 ? res.rows[0]?.[column] : null) ?? "";
      }
      if (!create) {
        toast.error(t("browse.noDefinition"));
        return;
      }
      setMode("sql");
      sendToSql(routineScript(connection.engine, entry, create), true);
    } catch (e) {
      toast.error(errorMessage(e, t("browse.loadFailed")));
    } finally {
      setOpening(false);
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const move = (e: PointerEvent) => {
      latest = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + e.clientX - startX),
      );
      setWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        // Storage can be blocked.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const showTables = mode === "tables" || mode === "sql";

  return (
    <PanelShell
      icon={<Database className="size-4" />}
      leading={<BackButton onClick={onBack} />}
      title={connection.name}
      status={`${t(`conn.engine.${connection.engine}`)}${db ? ` | ${db}` : ""}`}
      toolbar={
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "tables", label: t("browse.tables") },
            // SQLite has no stored procedures.
            ...(connection.engine === "sqlite"
              ? []
              : [{ value: "routines" as const, label: t("browse.routines") }]),
            { value: "sql", label: t("browse.sql") },
          ]}
        />
      }
    >
      {error && (
        <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {/* No flex-wrap: wrapped lines grow with their content, so the lists
          below never got a height to scroll in. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row"
        style={{ "--db-list-width": `${width}px` } as React.CSSProperties}
      >
        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-b border-border md:max-h-none md:w-[var(--db-list-width)] md:border-b-0">
          {databases && databases.length > 1 && (
            <div
              className={`shrink-0 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
            >
              <SelectField
                label={t("browse.database")}
                value={db}
                onChange={setDb}
                options={databases.map((name) => ({
                  value: name,
                  label: name,
                }))}
              />
            </div>
          )}
          {mode === "routines" && (
            <>
              <div
                className={`shrink-0 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
              >
                <PanelSearch
                  className="w-full md:w-full"
                  value={search}
                  onChange={setSearch}
                  placeholder={t("browse.searchRoutines")}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelList
                  empty={
                    routines ? (
                      <p className="p-3 text-xs text-muted-foreground">
                        {t("browse.noRoutines")}
                      </p>
                    ) : undefined
                  }
                >
                  {visibleRoutines.map((entry, index) => (
                    <ListRow
                      key={`${entry.schema}.${entry.name}.${index}`}
                      stripe={index}
                      icon={<Braces className="size-4" />}
                      title={entry.name}
                      selected={routine === entry}
                      onClick={() => setRoutine(entry)}
                      badges={
                        <ListBadge>
                          {entry.kind === "procedure"
                            ? t("browse.procedure")
                            : t("browse.function")}
                        </ListBadge>
                      }
                    />
                  ))}
                </PanelList>
              </div>
            </>
          )}
          {showTables && (
            <>
              <div
                className={`shrink-0 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
              >
                <PanelSearch
                  className="w-full md:w-full"
                  value={search}
                  onChange={setSearch}
                  placeholder={t("browse.search")}
                />
              </div>
              {mode === "sql" && (
                <p className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
                  {t("browse.insertName")}
                </p>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelList
                  empty={
                    tables ? (
                      <p className="p-3 text-xs text-muted-foreground">
                        {t("browse.noTables")}
                      </p>
                    ) : undefined
                  }
                >
                  {visible.map((entry, index) => (
                    <ListRow
                      key={tableKey(entry)}
                      stripe={index}
                      icon={
                        entry.kind === "view" ? (
                          <Eye className="size-4" />
                        ) : (
                          <Table2 className="size-4" />
                        )
                      }
                      title={nameOf(entry)}
                      selected={
                        mode === "tables" &&
                        selected?.schema === entry.schema &&
                        selected?.name === entry.name
                      }
                      onClick={() =>
                        mode === "sql"
                          ? sendToSql(nameOf(entry), false)
                          : setSelected(entry)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        void copyName(entry);
                      }}
                      badges={
                        entry.kind === "view" ? (
                          <ListBadge>{t("browse.view")}</ListBadge>
                        ) : undefined
                      }
                      meta={mode === "tables" ? rowsMeta(entry) : undefined}
                      actions={
                        <ListRowAction
                          label={t("browse.copyName")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyName(entry);
                          }}
                        >
                          <Copy />
                        </ListRowAction>
                      }
                    />
                  ))}
                </PanelList>
              </div>
            </>
          )}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("browse.resize")}
          title={t("browse.resize")}
          onPointerDown={startResize}
          className="hidden w-1 shrink-0 cursor-col-resize border-r border-border hover:bg-accent-brand/40 md:block"
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === "sql" ? (
            <SqlConsole
              hostId={hostId}
              connection={connection}
              db={db}
              insert={insert}
            />
          ) : mode === "routines" ? (
            routine ? (
              <>
                <div
                  className={`flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {routine.name}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={opening}
                    onClick={() => void openRoutineInSql(routine)}
                  >
                    <PencilLine className="size-3.5" />
                    {t("browse.openInSql")}
                  </Button>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-xs">
                  {routine.definition ?? t("browse.noDefinition")}
                </pre>
              </>
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                {t("browse.pickRoutine")}
              </p>
            )
          ) : selected ? (
            <>
              <div
                className={`shrink-0 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
              >
                <Segmented<Pane>
                  className="w-fit"
                  value={pane}
                  onChange={setPane}
                  options={[
                    { value: "data", label: t("data.title") },
                    { value: "structure", label: t("structure.title") },
                  ]}
                />
              </div>
              {pane === "data" ? (
                <DataGrid
                  key={`${db}.${selected.schema}.${selected.name}`}
                  hostId={hostId}
                  connection={connection}
                  db={db}
                  table={selected}
                  onTotal={(total) => onTotal(selected, total)}
                />
              ) : (
                <StructureView
                  key={`${db}.${selected.schema}.${selected.name}`}
                  hostId={hostId}
                  connection={connection}
                  db={db}
                  table={selected}
                />
              )}
            </>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              {t("browse.pick")}
            </p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
