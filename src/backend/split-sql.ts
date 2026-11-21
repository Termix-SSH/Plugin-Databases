/**
 * Splits SQL into statements on semicolons outside quotes and comments.
 * Returns the text as one statement when it can't be sure, such as with a
 * DELIMITER line or a BEGIN ... END block.
 */
export function splitStatements(sql: string, engine: string): string[] {
  if (/^\s*delimiter\s/im.test(sql) || /\bbegin\b[\s\S]*\bend\b/i.test(sql)) {
    return sql.trim() ? [sql.trim()] : [];
  }
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "'" || ch === '"' || (ch === "`" && engine === "mysql")) {
      i += 1;
      while (i < n) {
        if (sql[i] === "\\" && engine === "mysql") {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "#" && engine === "mysql") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (ch === "$" && engine === "postgres") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end < 0 ? n : end + tag[0].length;
        continue;
      }
    }
    if (ch === ";") {
      const text = sql.slice(start, i).trim();
      if (text) out.push(text);
      start = i + 1;
    }
    i += 1;
  }
  const rest = sql.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

const READ_WORDS = new Set([
  "select",
  "with",
  "show",
  "explain",
  "describe",
  "desc",
  "pragma",
  "values",
  "table",
]);

/** Drops leading comments, so the first word can be read. */
function firstWord(statement: string): string {
  let text = statement.trimStart();
  for (;;) {
    if (text.startsWith("--") || text.startsWith("#")) {
      const end = text.indexOf("\n");
      text = end < 0 ? "" : text.slice(end + 1).trimStart();
    } else if (text.startsWith("/*")) {
      const end = text.indexOf("*/");
      text = end < 0 ? "" : text.slice(end + 2).trimStart();
    } else break;
  }
  return (/^[A-Za-z]+/.exec(text)?.[0] ?? "").toLowerCase();
}

/** A statement that only reads, so it can run on its own connection. */
export function isReadStatement(statement: string): boolean {
  return READ_WORDS.has(firstWord(statement));
}

/**
 * The statements to run one by one so each shows its own result, or null
 * to run the text as it is in one session. Only reads are split, because a
 * statement on its own connection loses session state.
 */
export function resultStatements(sql: string, engine: string): string[] | null {
  const statements = splitStatements(sql, engine);
  if (statements.length < 2 || statements.length > 20) return null;
  return statements.every(isReadStatement) ? statements : null;
}
