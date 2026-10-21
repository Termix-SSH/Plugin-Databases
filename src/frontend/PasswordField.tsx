import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Field, Input } from "@termix-ssh/plugin-sdk/ui";

/** A password input with a show toggle, the same height as the other fields. */
export function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <Field label={label}>
      <div className="relative w-full">
        <Input
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          className="pr-8"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
          aria-label={shown ? t("conn.hidePassword") : t("conn.showPassword")}
          title={shown ? t("conn.hidePassword") : t("conn.showPassword")}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  );
}
