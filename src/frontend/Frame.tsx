import type { ReactNode } from "react";

// A fixed height box, so the panel body inside it can scroll.
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-hidden">
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
