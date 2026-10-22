import { Database } from "lucide-react";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { initApi } from "./api";
import { DatabasesTab } from "./DatabasesTab";
import {
  DatabasesCompanion,
  useDatabasesCompanionDefaults,
} from "./DatabasesCompanion";

const TAB_ID = "databases";

export function databasesEnabled(host: object | null | undefined): boolean {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.[TAB_ID]?.enableDatabases === true;
}

export function databasesPanelEnabled(
  host: object | null | undefined,
): boolean {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return databasesEnabled(host) && all?.[TAB_ID]?.showPanel !== false;
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

  app.registerCompanion(TAB_ID, DatabasesCompanion, {
    icon: Database,
    titleKey: "tab.title",
    order: 120,
    tabTypes: ["terminal"],
    when: (_tab, host) =>
      canUse && !!host?.enableSsh && databasesPanelEnabled(host),
    useDefaults: useDatabasesCompanionDefaults,
  });
  app.registerAction("databases.togglePanel", ((
    _handle: unknown,
    tab: unknown,
  ) => app.toggleCompanion(tab as never, TAB_ID)) as never);
  app.registerSlotContribution("tab.menu", {
    actionId: "databases.togglePanel",
    titleKey: "companion.toggle",
    icon: Database,
    kind: "button",
    order: 15,
    when: (context) => {
      const tab = context.tab as {
        type?: string;
        host?: unknown;
        hostConfig?: unknown;
      } | null;
      return (
        tab?.type === "terminal" &&
        databasesPanelEnabled((tab.host ?? tab.hostConfig) as object)
      );
    },
  });
}
