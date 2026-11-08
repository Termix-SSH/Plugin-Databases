import { useCallback, useEffect, useState } from "react";
import { Database } from "lucide-react";
import { useTranslation, type TabProps } from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Alert,
  AlertDescription,
  Button,
  ListBadge,
  ListRow,
  PanelList,
  PanelShell,
  EmptyState,
  PanelFrame,
  RefreshButton,
  NoticePanel,
} from "@termix-ssh/plugin-sdk/ui";
import type { ConnectionView, ToolsView } from "../shared/types";
import { errorCode, errorMessage, getTools, listConnections } from "./api";
import { Browser } from "./Browser";
import { ConnectionEditor } from "./ConnectionEditor";

const CLIENT: Record<ConnectionView["engine"], keyof ToolsView> = {
  mysql: "mysql",
  postgres: "psql",
  sqlite: "sqlite3",
};

/** Databases for one host: saved logins, then a browser for the chosen one. */
export function DatabasesTab({ isVisible, host, label }: TabProps) {
  const { t } = useTranslation();
  const hostId = Number(host?.id);
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [tools, setTools] = useState<ToolsView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ConnectionView | null>(null);
  const [editing, setEditing] = useState<ConnectionView | "new" | null>(null);

  const load = useCallback(async () => {
    if (!hostId) return;
    setLoading(true);
    try {
      const list = await listConnections(hostId);
      setConnections(list);
      setError("");
      // The tools check is a hint only, so a failure is not shown.
      getTools(hostId)
        .then(setTools)
        .catch((e) => {
          if (errorCode(e) === "sudo") setError(t("tab.sudo"));
        });
    } catch (e) {
      setError(errorMessage(e, t("tab.error")));
    } finally {
      setLoading(false);
    }
  }, [hostId, t]);

  useEffect(() => {
    if (!isVisible) return;
    void load();
  }, [isVisible, load]);

  if (!host) {
    return <EmptyState title={t("tab.noHost")} />;
  }

  const title = label || host.name || t("tab.title");

  if (editing) {
    return (
      <PanelFrame>
        <ConnectionEditor
          // A fresh editor per login so old form state never carries over.
          key={editing === "new" ? "new" : editing.id}
          hostId={hostId}
          connection={editing === "new" ? null : editing}
          tools={tools}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      </PanelFrame>
    );
  }

  if (active) {
    return (
      <PanelFrame>
        <Browser
          hostId={hostId}
          connection={active}
          isVisible={isVisible}
          onBack={() => setActive(null)}
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame>
      <PanelShell
        icon={<Database className="size-4" />}
        title={title}
        actions={
          <>
            <RefreshButton
              onClick={() => void load()}
              loading={loading}
              label={t("common.refresh")}
            />
            <AddButton
              label={t("conn.add")}
              onClick={() => setEditing("new")}
            />
          </>
        }
      >
        <div className="flex flex-1 shrink-0 flex-col">
          {error ? (
            <Alert className="border-x-0 border-t-0 text-xs">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {tools && !tools.mysql && !tools.psql && !tools.sqlite3 && (
            <Alert className="border-x-0 border-t-0 text-xs">
              <AlertDescription>{t("tab.noTools")}</AlertDescription>
            </Alert>
          )}
          {connections && (
            <PanelList
              empty={
                <NoticePanel title={t("tab.empty")}>
                  {t("tab.emptyHint")}
                </NoticePanel>
              }
            >
              {connections.map((c, index) => (
                <ListRow
                  key={c.id}
                  stripe={index}
                  icon={<Database className="size-4" />}
                  title={c.name}
                  tone="brand"
                  onClick={() => setActive(c)}
                  badges={
                    <>
                      <ListBadge>{t(`conn.engine.${c.engine}`)}</ListBadge>
                      {c.readOnly && (
                        <ListBadge tone="warning">
                          {t("conn.readOnlyBadge")}
                        </ListBadge>
                      )}
                      {tools && !tools[CLIENT[c.engine]] && (
                        <ListBadge tone="destructive">
                          {t("tab.clientMissing")}
                        </ListBadge>
                      )}
                    </>
                  }
                  meta={
                    <span className="font-mono">
                      {c.engine === "sqlite"
                        ? c.database
                        : c.address
                          ? `${c.address}${c.port ? `:${c.port}` : ""}`
                          : t("conn.socket")}
                    </span>
                  }
                  actions={
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(c);
                      }}
                    >
                      {t("conn.edit")}
                    </Button>
                  }
                />
              ))}
            </PanelList>
          )}
        </div>
      </PanelShell>
    </PanelFrame>
  );
}
