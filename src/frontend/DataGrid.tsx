import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Alert,
  AlertDescription,
  Button,
  Input,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type {
  ConnectionView,
  RowValues,
  RowsView,
  TableEntry,
} from "../shared/types";
import { deleteRow, errorMessage, getRows, insertRow, updateRow } from "./api";
import { download, toCsv, toJson } from "./exportGrid";
import { GridTable } from "./GridTable";
import { RowEditor } from "./RowEditor";

const PAGE = 100;

type Editing = { index: number } | "new" | null;

/** One table's rows: sort, filter, page, add, edit, delete and export. */
export function DataGrid({
  hostId,
  connection,
  db,
  table,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
  table: TableEntry;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<RowsView | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{
    column: string;
    dir: "asc" | "desc";
  } | null>(null);
  const [filterText, setFilterText] = useState("");
  const [where, setWhere] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await getRows(hostId, connection.id, {
          db,
          schema: table.schema,
          table: table.name,
          limit: PAGE,
          offset,
          orderBy: sort?.column ?? "",
          dir: sort?.dir ?? "asc",
          where,
        }),
      );
      setError("");
    } catch (e) {
      setError(errorMessage(e, t("data.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [
    hostId,
    connection.id,
    db,
    table.schema,
    table.name,
    offset,
    sort,
    where,
    t,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const keyColumns = useMemo(
    () =>
      new Set(
        (data?.columns ?? []).filter((c) => c.primary).map((c) => c.name),
      ),
    [data],
  );
  const hasKey = keyColumns.size > 0;
  const isView = table.kind === "view";
  const canWrite = hasKey && !isView && !connection.readOnly;

  const target = { db, schema: table.schema, table: table.name };

  const save = async (values: RowValues, key: RowValues) => {
    const index = editing && editing !== "new" ? editing.index : -1;
    if (index >= 0 && Object.keys(values).length === 0) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      if (index >= 0) {
        await updateRow(hostId, connection.id, { ...target, key, values });
      } else {
        await insertRow(hostId, connection.id, { ...target, values });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setSaveError(errorMessage(e, t("row.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (key: RowValues) => {
    const ok = await confirm({
      title: t("row.deleteTitle"),
      description: t("row.deleteDesc"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await deleteRow(hostId, connection.id, { ...target, key });
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, t("row.deleteFailed")));
    }
  };

  const toggleSort = (column: string) => {
    setOffset(0);
    setSort((current) =>
      current?.column !== column
        ? { column, dir: "asc" }
        : current.dir === "asc"
          ? { column, dir: "desc" }
          : null,
    );
  };

  const applyFilter = () => {
    setOffset(0);
    setWhere(filterText.trim());
  };

  const exportAs = (format: "csv" | "json") => {
    if (!data) return;
    const { columns, rows } = data.grid;
    if (format === "csv") {
      download(`${table.name}.csv`, toCsv(columns, rows), "text/csv");
    } else {
      download(`${table.name}.json`, toJson(columns, rows), "application/json");
    }
  };

  const total = data?.total ?? 0;
  const shown = data?.grid.rows.length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilter();
          }}
          placeholder={t("data.filterPlaceholder")}
          className="h-8 min-w-48 flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" onClick={applyFilter}>
          {t("data.apply")}
        </Button>
        {where && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterText("");
              setWhere("");
              setOffset(0);
            }}
          >
            {t("data.clear")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void load()}
          disabled={loading}
          title={t("common.refresh")}
          className="text-accent-brand"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!data}
          onClick={() => exportAs("csv")}
        >
          <Download className="size-3.5" />
          CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!data}
          onClick={() => exportAs("json")}
        >
          <Download className="size-3.5" />
          JSON
        </Button>
        {!isView && (
          <AddButton
            label={t("data.add")}
            disabled={connection.readOnly}
            onClick={() => {
              setSaveError("");
              setEditing("new");
            }}
          />
        )}
      </div>
      {data && !hasKey && !isView && (
        <Alert className="shrink-0 rounded-none text-xs">
          <AlertDescription>{t("data.noKey")}</AlertDescription>
        </Alert>
      )}
      {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
      {data && (
        <>
          {data.grid.rows.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              {t("data.noRows")}
            </p>
          ) : (
            <GridTable
              columns={data.grid.columns}
              rows={data.grid.rows}
              sort={sort}
              onSort={toggleSort}
              keyColumns={keyColumns}
              onRowClick={
                isView
                  ? undefined
                  : (index) => {
                      setSaveError("");
                      setEditing({ index });
                    }
              }
            />
          )}
          <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
            <span>
              {shown > 0
                ? t("data.range", {
                    from: offset + 1,
                    to: offset + shown,
                    total,
                  })
                : t("data.rowCount", { count: total })}
            </span>
            <span className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
                title={t("data.prev")}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={offset + shown >= total || loading}
                onClick={() => setOffset(offset + PAGE)}
                title={t("data.next")}
              >
                <ChevronRight className="size-4" />
              </Button>
            </span>
          </div>
        </>
      )}
      {editing && data && (
        <RowEditor
          key={editing === "new" ? "new" : editing.index}
          columns={data.columns}
          row={editing === "new" ? null : data.grid.rows[editing.index]}
          canWrite={editing === "new" ? !connection.readOnly : canWrite}
          saving={saving}
          error={saveError}
          onClose={() => setEditing(null)}
          onSave={(values, key) => void save(values, key)}
          onDelete={canWrite ? (key) => void remove(key) : undefined}
        />
      )}
    </div>
  );
}
