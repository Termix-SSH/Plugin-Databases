import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  FileJson,
  ListTree,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
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
  LoadingState,
  PanelList,
  PanelSearch,
  PanelShell,
  Segmented,
  SelectField,
  TOOLBAR_FIT,
  TextAreaField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, MongoCollection } from "../shared/types";
import {
  errorMessage,
  listDatabases,
  mongoCollections,
  mongoConsole,
  mongoFind,
  mongoIndexes,
  mongoWrite,
} from "./api";

type Mode = "documents" | "console";

const PAGE = 50;

/** Pretty Extended JSON for the editor and the list. */
export function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** The document's _id as Extended JSON text, for replace and delete. */
export function idOf(text: string): string | null {
  try {
    const doc = JSON.parse(text) as { _id?: unknown };
    return doc._id === undefined ? null : JSON.stringify(doc._id);
  } catch {
    return null;
  }
}

/** Databases, collections and documents of one MongoDB login. */
export function MongoBrowser({
  hostId,
  connection,
  onBack,
}: {
  hostId: number;
  connection: ConnectionView;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("documents");
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [db, setDb] = useState(connection.database);
  const [collections, setCollections] = useState<MongoCollection[] | null>(
    null,
  );
  const [collection, setCollection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const writable = !connection.readOnly;

  useEffect(() => {
    listDatabases(hostId, connection.id)
      .then((list) => {
        setDatabases(list);
        setDb((current) => current || list[0] || "");
      })
      .catch((e) => {
        setDatabases([]);
        toast.error(errorMessage(e, t("mongo.loadFailed")));
      });
  }, [hostId, connection.id, toast, t]);

  const loadCollections = useCallback(async () => {
    if (!db) return;
    setCollections(null);
    try {
      setCollections(await mongoCollections(hostId, connection.id, db));
    } catch (e) {
      setCollections([]);
      toast.error(errorMessage(e, t("mongo.loadFailed")));
    }
  }, [hostId, connection.id, db, toast, t]);

  useEffect(() => {
    setCollection(null);
    void loadCollections();
  }, [loadCollections]);

  const visible = (collections ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <PanelShell
      icon={<Database className="size-4" />}
      leading={<BackButton onClick={onBack} />}
      title={connection.name}
      status={`${t("conn.engine.mongo")}${db ? ` | ${db}` : ""}`}
      toolbar={
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "documents", label: t("mongo.documents") },
            ...(writable
              ? [{ value: "console" as const, label: t("mongo.console") }]
              : []),
          ]}
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-b border-border md:max-h-none md:w-64 md:border-b-0 md:border-r">
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
          {mode === "documents" && (
            <>
              <div
                className={`shrink-0 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
              >
                <PanelSearch
                  className="w-full md:w-full"
                  value={search}
                  onChange={setSearch}
                  placeholder={t("mongo.searchCollections")}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {collections === null ? (
                  <LoadingState label={t("mongo.loading")} />
                ) : (
                  <PanelList
                    empty={
                      <p className="p-3 text-xs text-muted-foreground">
                        {t("mongo.noCollections")}
                      </p>
                    }
                  >
                    {visible.map((entry, index) => (
                      <ListRow
                        key={entry.name}
                        stripe={index}
                        icon={<FileJson className="size-4" />}
                        title={entry.name}
                        selected={collection === entry.name}
                        onClick={() => setCollection(entry.name)}
                        badges={
                          entry.type === "view" ? (
                            <ListBadge>{t("browse.view")}</ListBadge>
                          ) : undefined
                        }
                        meta={
                          entry.count === null
                            ? undefined
                            : t("mongo.count", { count: entry.count })
                        }
                      />
                    ))}
                  </PanelList>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === "console" ? (
            <MongoConsole hostId={hostId} connection={connection} db={db} />
          ) : collection ? (
            <Documents
              key={`${db}.${collection}`}
              hostId={hostId}
              connection={connection}
              db={db}
              collection={collection}
              writable={
                writable &&
                collections?.find((c) => c.name === collection)?.type !== "view"
              }
            />
          ) : (
            <p className="p-3 text-xs text-muted-foreground">
              {t("mongo.pick")}
            </p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function Documents({
  hostId,
  connection,
  db,
  collection,
  writable,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
  collection: string;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("");
  const [query, setQuery] = useState({ filter: "", sort: "" });
  const [skip, setSkip] = useState(0);
  const [docs, setDocs] = useState<string[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{
    id: string | null;
    text: string;
  } | null>(null);
  const [indexes, setIndexes] = useState<unknown[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setDocs(null);
    try {
      const page = await mongoFind(hostId, connection.id, {
        db,
        collection,
        filter: query.filter,
        sort: query.sort,
        skip,
        limit: PAGE,
      });
      setDocs(page.docs);
      setTotal(page.total);
      setError("");
    } catch (e) {
      setDocs([]);
      setError(errorMessage(e, t("mongo.loadFailed")));
    }
  }, [hostId, connection.id, db, collection, query, skip, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = () => {
    setSkip(0);
    setQuery({ filter: filter.trim(), sort: sort.trim() });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const doc = JSON.stringify(JSON.parse(editing.text));
      if (editing.id) {
        await mongoWrite(hostId, connection.id, "replace", {
          db,
          collection,
          id: editing.id,
          doc,
        });
      } else {
        await mongoWrite(hostId, connection.id, "insert", {
          db,
          collection,
          doc,
        });
      }
      setEditing(null);
      void load();
    } catch (e) {
      toast.error(
        e instanceof SyntaxError
          ? t("mongo.badJson")
          : errorMessage(e, t("mongo.saveFailed")),
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (text: string) => {
    const id = idOf(text);
    if (!id) return;
    const ok = await confirm({
      title: t("mongo.deleteTitle"),
      description: id,
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await mongoWrite(hostId, connection.id, "delete", { db, collection, id });
      void load();
    } catch (e) {
      toast.error(errorMessage(e, t("mongo.saveFailed")));
    }
  };

  return (
    <>
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
      >
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("mongo.filter")}
          className="min-w-48 flex-1 font-mono text-xs"
          spellCheck={false}
        />
        <Input
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          placeholder={t("mongo.sort")}
          className="w-44 font-mono text-xs"
          spellCheck={false}
        />
        <Button size="sm" onClick={apply}>
          {t("mongo.apply")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void mongoIndexes(hostId, connection.id, db, collection)
              .then(setIndexes)
              .catch((e) => toast.error(errorMessage(e, t("mongo.loadFailed"))))
          }
        >
          <ListTree className="size-3.5" />
          {t("mongo.indexes")}
        </Button>
        {writable && (
          <AddButton
            label={t("mongo.insert")}
            onClick={() => setEditing({ id: null, text: "{\n  \n}" })}
          />
        )}
      </div>
      {error && (
        <p className="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {docs === null ? (
          <LoadingState label={t("mongo.loading")} />
        ) : docs.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {t("mongo.noDocuments")}
          </p>
        ) : (
          docs.map((text, index) => (
            <div
              key={`${skip + index}`}
              className="group relative border-b border-border px-3 py-2"
            >
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                {pretty(text)}
              </pre>
              {writable && idOf(text) && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    size="icon"
                    variant="ghost"
                    title={t("mongo.edit")}
                    aria-label={t("mongo.edit")}
                    onClick={() =>
                      setEditing({ id: idOf(text), text: pretty(text) })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                    onClick={() => void remove(text)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div
        className={`flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground ${TOOLBAR_FIT}`}
      >
        <span className="flex-1">
          {docs && docs.length > 0
            ? t("mongo.range", {
                from: skip + 1,
                to: skip + docs.length,
                total: total ?? "?",
              })
            : ""}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("mongo.previous")}
          disabled={skip === 0}
          onClick={() => setSkip(Math.max(0, skip - PAGE))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("mongo.next")}
          disabled={!docs || docs.length < PAGE}
          onClick={() => setSkip(skip + PAGE)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {editing && (
        <InlineView
          open
          onOpenChange={(next) => !next && setEditing(null)}
          title={editing.id ? t("mongo.edit") : t("mongo.insert")}
          footer={
            <FormFooter
              onCancel={() => setEditing(null)}
              onSave={() => void save()}
              saving={saving}
              cancelLabel={t("common.cancel")}
              saveLabel={t("common.save")}
            />
          }
        >
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <TextAreaField
              label={t("mongo.document")}
              hint={t("mongo.documentHint")}
              value={editing.text}
              onChange={(text) => setEditing({ ...editing, text })}
              mono
              fill
            />
          </div>
        </InlineView>
      )}
      {indexes && (
        <InlineView
          open
          onOpenChange={(next) => !next && setIndexes(null)}
          title={t("mongo.indexes")}
        >
          <pre className="overflow-auto p-3 font-mono text-xs">
            {JSON.stringify(indexes, null, 2)}
          </pre>
        </InlineView>
      )}
    </>
  );
}

function MongoConsole({
  hostId,
  connection,
  db,
}: {
  hostId: number;
  connection: ConnectionView;
  db: string;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("db.getCollectionNames()");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setError("");
    try {
      setOutput((await mongoConsole(hostId, connection.id, db, code)).output);
    } catch (e) {
      setOutput("");
      setError(errorMessage(e, t("mongo.runFailed")));
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
        label={t("mongo.code", { db: db || "test" })}
        value={code}
        onChange={setCode}
        rows={6}
        mono
      />
      <div className="flex shrink-0 items-center gap-2">
        <Button onClick={() => void run()} disabled={running || !code.trim()}>
          <Play className="size-3.5" />
          {running ? t("sql.running") : t("sql.run")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("mongo.consoleHint")}
        </span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {output && (
        <pre className="whitespace-pre-wrap break-all border border-border p-2 font-mono text-xs">
          {output}
        </pre>
      )}
    </div>
  );
}
