import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createRunner, matchesScope, RunnerError } from "../src/client.ts";
import type { Connector } from "../src/types.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function install(handler: (url: string, init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function runner() {
  return createRunner({
    baseUrl: "https://runner.example",
    apiKey: "ark_test",
    tenantId: "at_test",
  });
}

const lighthouse = {
  id: "hgi",
  organization_id: "org-1",
  property_id: "aria-dev",
  credential_id: null,
  connector_key: "lighthouse",
  name: "HGI",
  enabled: true,
  auth_status: "unauthenticated",
  config: {
    org_id: "org-1",
    hotel_id: "202158",
    development_property_id: "aria-dev",
    production_property_id: "aria-prod",
    environments: ["development"],
  },
};

describe("matchesScope", () => {
  const row: Connector = {
    id: "hgi",
    type: "lighthouse",
    name: "HGI",
    organizationId: "org-1",
    propertyId: "aria-dev",
    productionPropertyId: "aria-prod",
    loginId: null,
    enabled: true,
    authStatus: "unauthenticated",
    config: { property_id: "4603810" },
  };

  it("keeps an organization and matches either Aria property id", () => {
    assert.equal(matchesScope(row, { organizationId: "org-2" }), false);
    assert.equal(matchesScope(row, { organizationId: "org-1", propertyId: "aria-prod" }), true);
    assert.equal(matchesScope(row, { propertyId: "4603810" }), true);
    assert.equal(matchesScope(row, { propertyId: "other" }), false);
  });
});

describe("createRunner", () => {
  it("creates a connector in development and attaches a login", async () => {
    const calls = install((url, init) => {
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer ark_test");
      const body = JSON.parse(String(init?.body));
      assert.equal(url, "https://runner.example/v1/connections/hgi");
      assert.equal(body.connector_key, "lighthouse");
      assert.equal(body.api_tenant_id, "at_test");
      assert.equal(body.credential_id, "crd_1");
      assert.equal(body.config.org_id, "org-1");
      assert.equal(body.config.development_property_id, "aria-dev");
      assert.equal(body.config.hotel_id, "202158");
      assert.deepEqual(body.config.environments, ["development"]);
      return jsonResponse({ ...lighthouse, credential_id: "crd_1", config: body.config });
    });
    const created = await runner().createConnector({
      id: "hgi",
      type: "lighthouse",
      name: "HGI",
      organizationId: "org-1",
      propertyId: "aria-dev",
      loginId: "crd_1",
      config: { hotel_id: "202158" },
    });
    assert.equal(calls.length, 1);
    assert.equal(created.loginId, "crd_1");
    assert.equal(created.propertyId, "aria-dev");
  });

  it("lists connectors for one property", async () => {
    install(() =>
      jsonResponse([
        lighthouse,
        {
          ...lighthouse,
          id: "other",
          organization_id: "org-2",
          config: { ...lighthouse.config, org_id: "org-2", development_property_id: "aria-dev" },
        },
      ]),
    );
    const rows = await runner().listConnectors({ organizationId: "org-1", propertyId: "aria-dev" });
    assert.deepEqual(rows.map((row) => row.id), ["hgi"]);
  });

  it("refuses to move a connector to another organization", async () => {
    install((url) => {
      if (url.endsWith("/v1/connections/hgi")) return jsonResponse(lighthouse);
      return jsonResponse({ detail: "no" }, 500);
    });
    await assert.rejects(
      runner().patchConnector("hgi", { organizationId: "org-2" }),
      (error: unknown) => error instanceof RunnerError && error.status === 409,
    );
  });

  it("associates a login", async () => {
    install((url, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.credential_id, "crd_9");
        assert.equal(body.config.hotel_id, "202158");
        return jsonResponse({ ...lighthouse, credential_id: "crd_9", config: body.config });
      }
      return jsonResponse(lighthouse);
    });
    const saved = await runner().associateLogin("hgi", "crd_9");
    assert.equal(saved.loginId, "crd_9");
  });

  it("creates a login and stores its settings", async () => {
    const calls = install((url, init) => {
      if (url.endsWith("/v1/credentials") && init?.method === "POST") {
        return jsonResponse({
          id: "crd_1",
          name: "Lighthouse",
          organization_id: "org-1",
          property_id: null,
          kind: "password",
          auth_status: "unauthenticated",
          connection_ids: [],
        });
      }
      const body = JSON.parse(String(init?.body));
      assert.equal(body.values.password, "secret");
      return jsonResponse({ values: { username: "ada@example.com" }, saved_secrets: ["password"] });
    });
    const login = await runner().createLogin({
      name: "Lighthouse",
      organizationId: "org-1",
      username: "ada@example.com",
      password: "secret",
    });
    assert.equal(login.id, "crd_1");
    assert.equal(login.authStatus, "authenticated");
    assert.equal(calls.length, 2);
  });

  it("keeps the connector config schema", async () => {
    const schema = {
      type: "object",
      properties: { hotel_id: { type: "string", title: "Lighthouse hotel id" } },
    };
    install(() =>
      jsonResponse([
        {
          key: "lighthouse",
          display_name: "Lighthouse",
          config_schema: schema,
          auth: { fields: [{ key: "username", title: "Username", secret: false }] },
        },
      ]),
    );
    const [type] = await runner().connectorTypes();
    assert.equal(type.key, "lighthouse");
    assert.deepEqual(type.configSchema, schema);
    assert.equal(type.settings[0]?.key, "username");
  });

  it("starts a run and reads it back", async () => {
    const calls = install((url, init) => {
      if (init?.method === "POST") {
        assert.equal(url, "https://runner.example/v1/connections/hgi/runs");
        assert.deepEqual(JSON.parse(String(init.body)), { params: {} });
        return jsonResponse({
          id: "run_1",
          connection_id: "hgi",
          connector_key: "lighthouse",
          status: "queued",
          error: null,
          created_at: "2026-10-13T00:00:00Z",
          started_at: null,
          finished_at: null,
        });
      }
      if (url.endsWith("/v1/connections/hgi/runs")) {
        return jsonResponse([
          {
            id: "run_1",
            connection_id: "hgi",
            connector_key: "lighthouse",
            status: "running",
            created_at: "2026-10-13T00:00:00Z",
          },
        ]);
      }
      assert.equal(url, "https://runner.example/v1/runs/run_1");
      return jsonResponse({
        id: "run_1",
        connection_id: "hgi",
        connector_key: "lighthouse",
        status: "succeeded",
        created_at: "2026-10-13T00:00:00Z",
        finished_at: "2026-10-13T00:05:00Z",
      });
    });
    const started = await runner().startRun("hgi");
    const listed = await runner().listConnectionRuns("hgi");
    const loaded = await runner().getRun("run_1");
    assert.equal(started.status, "queued");
    assert.equal(listed[0]?.status, "running");
    assert.equal(loaded.status, "succeeded");
    assert.equal(calls.length, 3);
  });

  it("saves connector settings", async () => {
    install((url, init) => {
      assert.equal(url, "https://runner.example/v1/connections/hgi/credentials");
      assert.equal(init?.method, "PUT");
      return jsonResponse({ values: { username: "ada@example.com" }, saved_secrets: ["password"] });
    });
    const settings = await runner().saveSettings("hgi", {
      username: "ada@example.com",
      password: "",
    });
    assert.deepEqual(settings.savedSecrets, ["password"]);
  });
});
