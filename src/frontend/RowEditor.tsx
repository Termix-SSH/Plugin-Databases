import { useState } from "react";
import { Table2 } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Facts,
  FormFooter,
  InlineView,
  TextAreaField,
} from "@termix-ssh/plugin-sdk/ui";
import type { ColumnInfo, RowValues } from "../shared/types";

interface Cell {
  text: string;
  isNull: boolean;
  touched: boolean;
}

/**
 * Adds a row or edits one. For an edit only the changed values are sent, and
 * the old key values find the row. For an add only the touched fields are sent.
 */
export function RowEditor({
  columns,
  row,
  canWrite,
  saving,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  columns: ColumnInfo[];
  /** The row being edited, or null for a new row. */
  row: Array<string | null> | null;
  canWrite: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: RowValues, key: RowValues) => void;
  onDelete?: (key: RowValues) => void;
}) {
  const { t } = useTranslation();
  const [cells, setCells] = useState<Record<string, Cell>>(() => {
    const out: Record<string, Cell> = {};
    columns.forEach((column, index) => {
      const value = row ? (row[index] ?? null) : null;
      out[column.name] = {
        text: value ?? "",
        isNull: row ? value === null : false,
        touched: false,
      };
    });
    return out;
  });

  const patch = (name: string, change: Partial<Cell>) =>
    setCells((current) => ({
      ...current,
      [name]: { ...current[name], ...change, touched: true },
    }));

  const key = (): RowValues => {
    const out: RowValues = {};
    columns.forEach((column, index) => {
      if (column.primary && row) out[column.name] = row[index] ?? null;
    });
    return out;
  };

  const save = () => {
    const values: RowValues = {};
    for (const column of columns) {
      const cell = cells[column.name];
      if (!column.editable || !cell.touched) continue;
      values[column.name] = cell.isNull ? null : cell.text;
    }
    onSave(values, key());
  };

  const locked = columns.filter((column) => !column.editable);

  return (
    <InlineView
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row ? t("row.editTitle") : t("row.addTitle")}
      icon={<Table2 className="size-4" />}
      footer={
        <FormFooter
          onCancel={onClose}
          onSave={save}
          saving={saving}
          disabled={!canWrite}
          cancelLabel={t("common.cancel")}
          saveLabel={t("common.save")}
          onDelete={row && onDelete ? () => onDelete(key()) : undefined}
          deleteLabel={t("common.delete")}
        />
      }
    >
      <div className="flex flex-col gap-3 p-3">
        {!canWrite && (
          <p className="text-xs text-muted-foreground">{t("data.readOnly")}</p>
        )}
        {columns
          .filter((column) => column.editable)
          .map((column) => {
            const cell = cells[column.name];
            return (
              <TextAreaField
                key={column.name}
                label={`${column.name}  ${column.type}${column.primary ? "  PK" : ""}`}
                value={cell.isNull ? "" : cell.text}
                onChange={(text) => patch(column.name, { text, isNull: false })}
                placeholder={
                  cell.isNull
                    ? "NULL"
                    : column.default !== null
                      ? t("row.defaultHint", { value: column.default })
                      : ""
                }
                rows={cell.text.length > 80 || cell.text.includes("\n") ? 4 : 1}
                mono
                disabled={!canWrite}
                aside={
                  column.nullable ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!canWrite}
                      onClick={() =>
                        patch(column.name, { isNull: !cell.isNull, text: "" })
                      }
                    >
                      {cell.isNull ? t("row.setValue") : t("row.setNull")}
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        {locked.length > 0 && (
          <div className="flex flex-col gap-1 border border-border p-3 text-xs">
            <p>{t("row.locked")}</p>
            <Facts>
              {locked.map((column) => (
                <span key={column.name} className="font-mono">
                  {column.name}
                </span>
              ))}
            </Facts>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </InlineView>
  );
}
