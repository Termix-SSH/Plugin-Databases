import { useState } from "react";
import { Database } from "lucide-react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Alert,
  AlertDescription,
  BackButton,
  Button,
  FormFooter,
  PanelShell,
  SelectField,
  SwitchRow,
  TextField,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import type {
  ConnectionInput,
  ConnectionView,
  EngineId,
  ToolsView,
} from "../shared/types";
import {
  createConnection,
  deleteConnection,
  errorMessage,
  testConnection,
  updateConnection,
} from "./api";
import { PasswordField } from "./PasswordField";

interface FormState {
  name: string;
  engine: EngineId;
  address: string;
  port: string;
  username: string;
  password: string;
  clearPassword: boolean;
  database: string;
  runAs: string;
  readOnly: boolean;
}

const DEFAULT_PORT: Record<EngineId, string> = {
  mysql: "3306",
  postgres: "5432",
  sqlite: "",
};

function initial(connection: ConnectionView | null): FormState {
  return {
    name: connection?.name ?? "",
    engine: connection?.engine ?? "mysql",
    address: connection?.address ?? "",
    port: connection?.port ? String(connection.port) : "",
    username: connection?.username ?? "",
    password: "",
    clearPassword: false,
    database: connection?.database ?? "",
    runAs: connection?.runAs ?? "",
    readOnly: connection?.readOnly ?? false,
  };
}

function toBody(form: FormState): ConnectionInput {
  return {
    name: form.name.trim(),
    engine: form.engine,
    address: form.address.trim(),
    port: form.port.trim() ? Number(form.port) : null,
    username: form.username.trim(),
    password: form.password,
    clearPassword: form.clearPassword,
    database: form.database.trim(),
    runAs: form.runAs.trim(),
    readOnly: form.readOnly,
  };
}

/** One saved login. The saved password is never shown, only kept or replaced. */
export function ConnectionEditor({
  hostId,
  connection,
  tools,
  onClose,
  onSaved,
}: {
  hostId: number;
  connection: ConnectionView | null;
  tools: ToolsView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => initial(connection));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [tested, setTested] = useState("");
  const set = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setTested("");
  };
  const sqlite = form.engine === "sqlite";
  const client =
    form.engine === "mysql"
      ? tools?.mysql
      : form.engine === "postgres"
        ? tools?.psql
        : tools?.sqlite3;

  const test = async () => {
    setTesting(true);
    setError("");
    setTested("");
    try {
      const result = await testConnection(hostId, {
        ...toBody(form),
        id: connection?.id,
      });
      setTested(t("conn.testOk", { version: result.version }));
    } catch (e) {
      setError(errorMessage(e, t("conn.testFailed")));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = toBody(form);
      if (connection) await updateConnection(hostId, connection.id, body);
      else await createConnection(hostId, body);
      onSaved();
    } catch (e) {
      setError(errorMessage(e, t("conn.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!connection) return;
    const ok = await confirm({
      title: t("conn.deleteTitle", { name: connection.name }),
      description: t("conn.deleteDesc"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await deleteConnection(hostId, connection.id);
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e, t("conn.deleteFailed")));
    }
  };

  return (
    <PanelShell
      icon={<Database className="size-4" />}
      leading={<BackButton onClick={onClose} />}
      title={connection ? connection.name : t("conn.addTitle")}
      className="gap-2 p-2.5"
    >
      <div className="flex shrink-0 flex-col gap-3">
        <TextField
          label={t("conn.name")}
          value={form.name}
          onChange={(name) => set({ name })}
          placeholder="app database"
        />
        <SelectField<EngineId>
          label={t("conn.type")}
          value={form.engine}
          onChange={(engine) => set({ engine })}
          options={[
            { value: "mysql", label: t("conn.engine.mysql") },
            { value: "postgres", label: t("conn.engine.postgres") },
            { value: "sqlite", label: t("conn.engine.sqlite") },
          ]}
        />
        {tools && !client && (
          <Alert className="rounded-none text-xs">
            <AlertDescription>{t("conn.clientMissing")}</AlertDescription>
          </Alert>
        )}
        {sqlite ? (
          <TextField
            label={t("conn.file")}
            hint={t("conn.fileHint")}
            value={form.database}
            onChange={(database) => set({ database })}
            placeholder="/var/lib/app/data.db"
            mono
          />
        ) : (
          <>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
              }}
            >
              <div style={{ gridColumn: "span 2" }}>
                <TextField
                  label={t("conn.address")}
                  hint={t("conn.addressHint")}
                  value={form.address}
                  onChange={(address) => set({ address })}
                  placeholder="127.0.0.1"
                  mono
                />
              </div>
              <TextField
                label={t("conn.port")}
                value={form.port}
                onChange={(port) => set({ port: port.replace(/\D/g, "") })}
                placeholder={DEFAULT_PORT[form.engine]}
                mono
              />
            </div>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
              }}
            >
              <TextField
                label={t("conn.user")}
                value={form.username}
                onChange={(username) => set({ username })}
                mono
              />
              <PasswordField
                label={t("conn.password")}
                value={form.password}
                onChange={(password) => set({ password })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {connection?.hasPassword && !form.clearPassword
                ? t("conn.passwordSaved")
                : t("conn.passwordHint")}
            </p>
            {connection?.hasPassword && (
              <SwitchRow
                label={t("conn.clearPassword")}
                checked={form.clearPassword}
                onChange={(clearPassword) => set({ clearPassword })}
              />
            )}
            <TextField
              label={t("conn.database")}
              hint={t("conn.databaseHint")}
              value={form.database}
              onChange={(database) => set({ database })}
              mono
            />
          </>
        )}
        <TextField
          label={t("conn.runAs")}
          hint={t("conn.runAsHint")}
          value={form.runAs}
          onChange={(runAs) => set({ runAs })}
          placeholder={form.engine === "postgres" ? "postgres" : ""}
          mono
        />
        <SwitchRow
          label={t("conn.readOnly")}
          description={t("conn.readOnlyDesc")}
          checked={form.readOnly}
          onChange={(readOnly) => set({ readOnly })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void test()}
            disabled={testing || saving}
          >
            {testing ? t("conn.testing") : t("conn.test")}
          </Button>
          {tested && <span className="text-xs text-success">{tested}</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <FormFooter
          onCancel={onClose}
          onSave={() => void save()}
          saving={saving}
          disabled={!form.name.trim()}
          cancelLabel={t("common.cancel")}
          saveLabel={t("common.save")}
          onDelete={connection ? () => void remove() : undefined}
          deleteLabel={t("common.delete")}
        />
      </div>
    </PanelShell>
  );
}
