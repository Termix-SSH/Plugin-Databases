import { ArrowDown, ArrowUp } from "lucide-react";

const MAX_CELL = 200;

function show(value: string): string {
  return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}...` : value;
}

/** A plain scrolling table of text cells. NULL is shown dimmed. */
export function GridTable({
  columns,
  rows,
  onRowClick,
  sort,
  onSort,
  keyColumns,
}: {
  columns: string[];
  rows: Array<Array<string | null>>;
  onRowClick?: (index: number) => void;
  sort?: { column: string; dir: "asc" | "desc" } | null;
  onSort?: (column: string) => void;
  keyColumns?: ReadonlySet<string>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto border border-border">
      <table className="w-max min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left font-medium"
              >
                {onSort ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-accent-brand"
                    onClick={() => onSort(column)}
                  >
                    <span>{column}</span>
                    {keyColumns?.has(column) && (
                      <span className="text-muted-foreground">PK</span>
                    )}
                    {sort?.column === column &&
                      (sort.dir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                  </button>
                ) : (
                  column
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              onClick={onRowClick ? () => onRowClick(index) : undefined}
              className={`border-b border-border/50 ${
                onRowClick ? "cursor-pointer hover:bg-muted/60" : ""
              }`}
            >
              {row.map((value, cellIndex) => (
                <td
                  key={cellIndex}
                  className="max-w-[24rem] truncate whitespace-nowrap px-2 py-1 font-mono"
                  title={value ?? "NULL"}
                >
                  {value === null ? (
                    <span className="text-muted-foreground/60">NULL</span>
                  ) : (
                    show(value)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
