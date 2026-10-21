import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import type { ConnectionView, Description, TableEntry } from "../shared/types";
import { describeTable, errorMessage } from "./api";

/** Columns with types and keys, then the indexes. */
export function StructureView({
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
  const [info, setInfo] = useState<Description | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    describeTable(hostId, connection.id, {
      db,
      schema: table.schema,
      table: table.name,
    })
      .then((result) => {
        if (live) setInfo(result);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e, t("data.loadFailed")));
      });
    return () => {
      live = false;
    };
  }, [hostId, connection.id, db, table.schema, table.name, t]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!info) return null;

  const head = "border-b border-border px-2 py-1.5 text-left font-medium";
  const cell = "px-2 py-1 font-mono";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted">
            <tr>
              <th className={head}>{t("structure.name")}</th>
              <th className={head}>{t("structure.type")}</th>
              <th className={head}>{t("structure.nullable")}</th>
              <th className={head}>{t("structure.key")}</th>
              <th className={head}>{t("structure.default")}</th>
              <th className={head}>{t("structure.extra")}</th>
            </tr>
          </thead>
          <tbody>
            {info.columns.map((column) => (
              <tr key={column.name} className="border-b border-border/50">
                <td className={cell}>{column.name}</td>
                <td className={cell}>{column.type}</td>
                <td className={cell}>
                  {column.nullable ? t("structure.yes") : t("structure.no")}
                </td>
                <td className={cell}>{column.primary ? "PK" : ""}</td>
                <td className={cell}>{column.default ?? ""}</td>
                <td className={cell}>{column.extra}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium">{t("structure.indexes")}</p>
        {info.indexes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("structure.noIndexes")}
          </p>
        ) : (
          <div className="border border-border">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {info.indexes.map((index) => (
                  <tr key={index.name} className="border-b border-border/50">
                    <td className={`${cell} whitespace-nowrap`}>
                      {index.name}
                    </td>
                    <td className={`${cell} break-all`}>{index.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
