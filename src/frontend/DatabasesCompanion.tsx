import {
  useSettings,
  type CompanionDefaults,
  type CompanionProps,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { DatabasesTab } from "./DatabasesTab";

/** Starting state of the panel, from the user's settings. */
export function useDatabasesCompanionDefaults(): CompanionDefaults {
  const { values } = useSettings("user");
  const side = values.companionSide;
  return {
    open: values.companionAutoOpen === true,
    side: side === "left" || side === "bottom" ? side : "right",
    size: typeof values.companionSize === "number" ? values.companionSize : 480,
    edgeButton: values.companionEdgeButton !== false,
  };
}

/** The host's databases beside its terminal, the same view as the tab. */
export function DatabasesCompanion({ tab, host, isVisible }: CompanionProps) {
  return (
    <DatabasesTab
      {...({ tab, host, isVisible, label: host?.name ?? "" } as TabProps)}
    />
  );
}
