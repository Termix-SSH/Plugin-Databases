export class DatabasesError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DatabasesError";
  }
}
