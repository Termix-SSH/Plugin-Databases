function csvCell(value: string | null): string {
  if (value === null) return "";
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(
  columns: string[],
  rows: Array<Array<string | null>>,
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

export function toJson(
  columns: string[],
  rows: Array<Array<string | null>>,
): string {
  const objects = rows.map((row) => {
    const out: Record<string, string | null> = {};
    columns.forEach((column, index) => {
      out[column] = row[index] ?? null;
    });
    return out;
  });
  return JSON.stringify(objects, null, 2);
}

/** Saves text as a file through a temporary link. */
export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
