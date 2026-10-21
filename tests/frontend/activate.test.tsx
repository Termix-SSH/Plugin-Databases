import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

const host = { id: 1, name: "db host", enableSsh: true };

const login = {
  id: 5,
  name: "shop db",
  engine: "mysql",
  address: "10.0.0.5",
  port: 3306,
  username: "root",
  hasPassword: true,
  database: "shop",
  runAs: "",
  readOnly: false,
};

const tableList = [
  { schema: "shop", name: "users", kind: "table", rows: 2 },
  { schema: "shop", name: "recent", kind: "view", rows: null },
];

const columns = [
  {
    name: "id",
    type: "int",
    nullable: false,
    primary: true,
    default: null,
    extra: "",
    editable: true,
  },
  {
    name: "name",
    type: "varchar(20)",
    nullable: true,
    primary: false,
    default: null,
    extra: "",
    editable: true,
  },
];

function api(connections: unknown[], extra: Record<string, unknown> = {}) {
  const post = vi.fn(async (url: string) => ({
    data: url.endsWith("/rows")
      ? {
          columns,
          total: 2,
          grid: {
            columns: ["id", "name"],
            rows: [
              ["1", "ann"],
              ["2", null],
            ],
          },
        }
      : { affected: 1 },
  }));
  const put = vi.fn(async () => ({ data: { affected: 1 } }));
  return {
    get: vi.fn(async (url: string) => {
      if (url in extra) return { data: extra[url] };
      if (url.endsWith("/connections")) return { data: connections };
      if (url.endsWith("/tools")) {
        return { data: { mysql: "mysql 8", psql: null, sqlite3: null } };
      }
      if (url.endsWith("/databases")) return { data: ["shop"] };
      if (url.endsWith("/tables")) return { data: tableList };
      if (url.endsWith("/describe")) {
        return {
          data: {
            columns,
            indexes: [{ name: "PRIMARY", definition: "BTREE (id)" }],
          },
        };
      }
      return { data: {} };
    }),
    post,
    put,
  };
}

describe(`${manifest.id} activate`, () => {
  it("registers the host tab", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["databases"]);
  });

  it("shows an empty state with no logins", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([]) as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.empty)).toBeTruthy();
  });

  it("lists saved logins", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([login]) as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    expect(await screen.findByText("shop db")).toBeTruthy();
    expect(screen.getByText("10.0.0.5:3306")).toBeTruthy();
  });

  it("opens a login, lists tables and shows rows", async () => {
    const mock = api([login]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: mock as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    fireEvent.click(await screen.findByText("shop db"));
    fireEvent.click(await screen.findByText("users"));
    expect(await screen.findByText("ann")).toBeTruthy();
    expect(screen.getByText("NULL")).toBeTruthy();
    expect(mock.post).toHaveBeenCalledWith(
      "/1/connections/5/rows",
      expect.objectContaining({ table: "users", limit: 100, offset: 0 }),
    );
  });

  it("edits a row and sends only the changed value with the key", async () => {
    const mock = api([login]);
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: mock as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    fireEvent.click(await screen.findByText("shop db"));
    fireEvent.click(await screen.findByText("users"));
    fireEvent.click(await screen.findByText("ann"));
    expect(await screen.findByText(locales.row.editTitle)).toBeTruthy();
    const box = screen.getByDisplayValue("ann");
    fireEvent.change(box, { target: { value: "anna" } });
    fireEvent.click(screen.getByText(locales.common.save));
    await waitFor(() => expect(mock.put).toHaveBeenCalled());
    expect(mock.put).toHaveBeenCalledWith(
      "/1/connections/5/row",
      expect.objectContaining({
        table: "users",
        key: { id: "1" },
        values: { name: "anna" },
      }),
    );
  });

  it("does not offer delete or save on a read only login", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([{ ...login, readOnly: true }]) as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    fireEvent.click(await screen.findByText("shop db"));
    fireEvent.click(await screen.findByText("users"));
    fireEvent.click(await screen.findByText("ann"));
    expect(await screen.findByText(locales.data.readOnly)).toBeTruthy();
    expect(screen.queryByText(locales.common.delete)).toBeNull();
  });

  it("shows the structure of a table", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([login]) as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    fireEvent.click(await screen.findByText("shop db"));
    fireEvent.click(await screen.findByText("users"));
    fireEvent.click(await screen.findByText(locales.structure.title));
    expect(await screen.findByText("BTREE (id)")).toBeTruthy();
  });

  it("opens the editor for a new login", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: api([]) as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    fireEvent.click(await screen.findByText(locales.conn.add));
    expect(await screen.findByText(locales.conn.addTitle)).toBeTruthy();
    expect(screen.getByText(locales.conn.address)).toBeTruthy();
  });

  it("shows an error when the host cannot be read", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      api: {
        get: vi.fn(async () => {
          throw new Error("offline");
        }),
      } as never,
    });
    rendered.renderTab("databases", { isVisible: true, host });
    expect(await screen.findByText(locales.tab.error)).toBeTruthy();
  });
});
