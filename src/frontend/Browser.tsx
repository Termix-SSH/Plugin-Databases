import { useEffect, useMemo, useState } from "react";
import { Braces, Database, Eye, Table2 } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  BackButton,
  ListBadge,
  ListRow,
  PanelList,
  PanelSearch,
  PanelShell,
  Segmented,
  SelectField,
} from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, RoutineEntry, TableEntry } from "../shared/types";
import { errorMessage, listDatabases, listRoutines, listTables } from "./api";
import { DataGrid } from "./DataGrid";
import { SqlConsole } from "./SqlConsole";
import { StructureView } from "./StructureView";

type Mode = "tables" | "routines" | "sql";
type Pane = "data" | "structure";

/** The tables of one login on the left, and the chosen table or SQL on the right. */
export function Browser({
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
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [db, setDb] = useState("");
  const [tables, setTables] = useState<TableEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TableEntry | null>(null);
  const [routines, setRoutines] = useState<RoutineEntry[] | null>(null);
  const [routine, setRoutine] = useState<RoutineEntry | null>(null);
  const [mode, setMode] = useState<Mode>("tables");
  const [pane, setPane] = useState<Pane>("data");
  const [error, setError] = useState("");

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
      className="gap-2 p-2.5"
    >
      {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
      {/* No flex-wrap: wrapped lines grow with their content, so the lists
          below never got a height to scroll in. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden md:flex-row">
        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col gap-2 md:max-h-none md:w-60">
          {databases && databases.length > 1 && (
            <SelectField
              label={t("browse.database")}
              value={db}
              onChange={setDb}
              options={databases.map((name) => ({ value: name, label: name }))}
            />
          )}
          {mode === "routines" && (
            <>
              <PanelSearch
                className="w-full md:w-full"
                value={search}
                onChange={setSearch}
                placeholder={t("browse.searchRoutines")}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelList
                  empty={
                    routines ? (
                      <p className="p-2 text-xs text-muted-foreground">
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
          {mode === "tables" && (
            <>
              <PanelSearch
                className="w-full md:w-full"
                value={search}
                onChange={setSearch}
                placeholder={t("browse.search")}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelList
                  empty={
                    tables ? (
                      <p className="p-2 text-xs text-muted-foreground">
                        {t("browse.noTables")}
                      </p>
                    ) : undefined
                  }
                >
                  {visible.map((entry, index) => (
                    <ListRow
                      key={`${entry.schema}.${entry.name}`}
                      stripe={index}
                      icon={
                        entry.kind === "view" ? (
                          <Eye className="size-4" />
                        ) : (
                          <Table2 className="size-4" />
                        )
                      }
                      title={
                        multiSchema
                          ? `${entry.schema}.${entry.name}`
                          : entry.name
                      }
                      selected={
                        selected?.schema === entry.schema &&
                        selected?.name === entry.name
                      }
                      onClick={() => setSelected(entry)}
                      badges={
                        entry.kind === "view" ? (
                          <ListBadge>{t("browse.view")}</ListBadge>
                        ) : undefined
                      }
                      meta={
                        entry.rows !== null ? (
                          <span>{t("browse.rows", { count: entry.rows })}</span>
                        ) : undefined
                      }
                    />
                  ))}
                </PanelList>
              </div>
            </>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {mode === "sql" ? (
            <SqlConsole hostId={hostId} connection={connection} db={db} />
          ) : mode === "routines" ? (
            routine ? (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre border border-border p-2 font-mono text-xs">
                {routine.definition ?? t("browse.noDefinition")}
              </pre>
            ) : (
              <p className="p-2 text-sm text-muted-foreground">
                {t("browse.pickRoutine")}
              </p>
            )
          ) : selected ? (
            <>
              <Segmented<Pane>
                className="self-start"
                value={pane}
                onChange={setPane}
                options={[
                  { value: "data", label: t("data.title") },
                  { value: "structure", label: t("structure.title") },
                ]}
              />
              {pane === "data" ? (
                <DataGrid
                  key={`${db}.${selected.schema}.${selected.name}`}
                  hostId={hostId}
                  connection={connection}
                  db={db}
                  table={selected}
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
            <p className="p-2 text-sm text-muted-foreground">
              {t("browse.pick")}
            </p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
