import { Database } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { DatabasesTab } from "./DatabasesTab";

const TAB_ID = "databases";

function databasesEnabled(host: object | null | undefined): boolean {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.[TAB_ID]?.enableDatabases === true;
}

export function activate(app: TermixApp): void {
  initApi(app.api);
  // Host actions filter synchronously, so the permission is read once here.
  let canUse = true;
  void app.hasPermission("use").then((allowed) => {
    canUse = allowed;
  });

  app.registerTab(TAB_ID, DatabasesTab, {
    icon: Database,
    titleKey: "tab.title",
    requiresHost: true,
    noHostMessageKey: "tab.noHost",
    persistent: true,
  });
  app.registerHostAction({
    id: TAB_ID,
    titleKey: "tab.title",
    icon: Database,
    kind: "open",
    order: 47,
    tabType: TAB_ID,
    when: (host) => canUse && !!host.enableSsh && databasesEnabled(host),
  });
}
