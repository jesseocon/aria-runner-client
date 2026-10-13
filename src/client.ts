import type {
  Connector,
  ConnectorInput,
  ConnectorPatch,
  ConnectorType,
  Login,
  LoginInput,
  LoginPatch,
  Run,
  Scope,
  Settings,
} from "./types.ts";

export type {
  Connector,
  ConnectorInput,
  ConnectorPatch,
  ConnectorType,
  Login,
  LoginInput,
  LoginPatch,
  Run,
  Scope,
  SettingField,
  Settings,
} from "./types.ts";

export class RunnerError extends Error {
  status: number;
  errors: string[];

  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export type RunnerOptions = {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  fetch?: typeof fetch;
};

type RawConnection = {
  id: string;
  organization_id?: string;
  property_id?: string | null;
  credential_id?: string | null;
  connector_key: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  auth_status: string;
};

type RawLogin = {
  id: string;
  organization_id: string | null;
  property_id: string | null;
  name: string;
  kind: "password" | "browser_session";
  auth_status: string;
  connection_ids?: string[];
};

type RawSettings = {
  values: Record<string, string>;
  saved_secrets?: string[];
};

type RawType = {
  key: string;
  display_name: string;
  config_schema?: Record<string, unknown>;
  auth?: { fields?: { key: string; title: string; secret: boolean }[] } | null;
};

type RawRun = {
  id: string;
  connection_id: string;
  connector_key: string;
  status: string;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function toConnector(row: RawConnection): Connector {
  const config = row.config ?? {};
  return {
    id: row.id,
    type: row.connector_key,
    name: row.name,
    organizationId: row.organization_id || text(config.org_id) || "",
    propertyId: text(config.development_property_id) ?? text(row.property_id),
    productionPropertyId: text(config.production_property_id),
    loginId: row.credential_id ?? null,
    enabled: row.enabled,
    authStatus: row.auth_status,
    config,
  };
}

export function matchesScope(row: Connector, scope: Scope): boolean {
  if (scope.organizationId && row.organizationId !== scope.organizationId) return false;
  if (!scope.propertyId) return true;
  const ids = [
    row.propertyId,
    row.productionPropertyId,
    text(row.config.property_id),
    text(row.config.development_property_id),
  ];
  return ids.includes(scope.propertyId);
}

function withScope(
  config: Record<string, unknown>,
  input: {
    organizationId: string;
    propertyId?: string | null;
    productionPropertyId?: string | null;
  },
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...config,
    org_id: input.organizationId,
  };
  if (!("environments" in config)) next.environments = ["development"];
  if (input.propertyId === null) delete next.development_property_id;
  else if (input.propertyId) next.development_property_id = input.propertyId;
  if (input.productionPropertyId === null) delete next.production_property_id;
  else if (input.productionPropertyId) next.production_property_id = input.productionPropertyId;
  return next;
}

export function createRunner(options: RunnerOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const textBody = await response.text();
    const data = textBody ? JSON.parse(textBody) : null;
    if (!response.ok) {
      const body = data as { detail?: unknown; errors?: unknown } | null;
      const errors = Array.isArray(body?.errors) ? body.errors.map(String) : [];
      const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
      throw new RunnerError(response.status, errors.length ? errors.join("\n") : detail, errors);
    }
    return data as T;
  }

  function toLogin(row: RawLogin): Login {
    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id ?? "",
      propertyId: row.property_id,
      kind: row.kind,
      authStatus: row.auth_status,
      connectorIds: row.connection_ids ?? [],
    };
  }

  function toSettings(row: RawSettings): Settings {
    return { values: row.values ?? {}, savedSecrets: row.saved_secrets ?? [] };
  }

  function toRun(row: RawRun): Run {
    return {
      id: row.id,
      connectionId: row.connection_id,
      connectorType: row.connector_key,
      status: row.status,
      error: row.error ?? null,
      createdAt: row.created_at,
      startedAt: row.started_at ?? null,
      finishedAt: row.finished_at ?? null,
    };
  }

  async function getRaw(id: string): Promise<RawConnection> {
    return request<RawConnection>(`/v1/connections/${id}`);
  }

  async function saveRaw(
    id: string,
    row: RawConnection,
    loginId: string | null,
  ): Promise<Connector> {
    const saved = await request<RawConnection>(`/v1/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        connector_key: row.connector_key,
        name: row.name,
        config: row.config,
        enabled: row.enabled,
        api_tenant_id: options.tenantId,
        credential_id: loginId ?? "",
      }),
    });
    return toConnector(saved);
  }

  return {
    async connectorTypes(): Promise<ConnectorType[]> {
      const rows = await request<RawType[]>("/v1/connectors");
      return rows.map((row) => ({
        key: row.key,
        name: row.display_name,
        settings: row.auth?.fields ?? [],
        configSchema: row.config_schema ?? {},
      }));
    },

    async startRun(id: string, params: Record<string, unknown> = {}): Promise<Run> {
      return toRun(
        await request<RawRun>(`/v1/connections/${id}/runs`, {
          method: "POST",
          body: JSON.stringify({ params }),
        }),
      );
    },

    async listConnectionRuns(id: string): Promise<Run[]> {
      const rows = await request<RawRun[]>(`/v1/connections/${id}/runs`);
      return rows.map(toRun);
    },

    async getRun(id: string): Promise<Run> {
      return toRun(await request<RawRun>(`/v1/runs/${id}`));
    },

    async listConnectors(scope: Scope = {}): Promise<Connector[]> {
      const rows = await request<RawConnection[]>("/v1/connections");
      return rows.map(toConnector).filter((row) => matchesScope(row, scope));
    },

    async getConnector(id: string): Promise<Connector> {
      return toConnector(await getRaw(id));
    },

    async createConnector(input: ConnectorInput): Promise<Connector> {
      const saved = await request<RawConnection>(`/v1/connections/${input.id}`, {
        method: "PUT",
        body: JSON.stringify({
          connector_key: input.type,
          name: input.name,
          enabled: input.enabled ?? true,
          api_tenant_id: options.tenantId,
          credential_id: input.loginId || null,
          config: withScope(input.config ?? {}, input),
        }),
      });
      return toConnector(saved);
    },

    async patchConnector(id: string, patch: ConnectorPatch): Promise<Connector> {
      const current = await getRaw(id);
      const organizationId = current.organization_id || text(current.config.org_id) || "";
      if (patch.organizationId && patch.organizationId !== organizationId) {
        throw new RunnerError(409, "organization cannot change on an existing connector");
      }
      current.name = patch.name ?? current.name;
      current.enabled = patch.enabled ?? current.enabled;
      current.config = withScope(
        { ...current.config, ...patch.config },
        {
          organizationId,
          propertyId: patch.propertyId,
          productionPropertyId: patch.productionPropertyId,
        },
      );
      const loginId = patch.loginId === undefined ? (current.credential_id ?? null) : patch.loginId;
      return saveRaw(id, current, loginId);
    },

    async associateLogin(id: string, loginId: string | null): Promise<Connector> {
      return this.patchConnector(id, { loginId });
    },

    async listLogins(scope: Scope = {}): Promise<Login[]> {
      const params = new URLSearchParams();
      if (scope.organizationId) params.set("organization_id", scope.organizationId);
      if (scope.propertyId) params.set("property_id", scope.propertyId);
      const text = params.toString();
      const query = text ? `?${text}` : "";
      const rows = await request<RawLogin[]>(
        `/v1/api-tenants/${options.tenantId}/credentials${query}`,
      );
      return rows.map(toLogin);
    },

    async createLogin(input: LoginInput): Promise<Login> {
      const row = await request<RawLogin>("/v1/credentials", {
        method: "POST",
        body: JSON.stringify({
          api_tenant_id: options.tenantId,
          name: input.name,
          kind: "password",
          organization_id: input.organizationId,
          property_id: input.propertyId || null,
        }),
      });
      if (input.username || input.password) {
        await request(`/v1/credentials/${row.id}`, {
          method: "PUT",
          body: JSON.stringify({
            values: { username: input.username ?? "", password: input.password ?? "" },
          }),
        });
        row.auth_status = "authenticated";
      }
      return toLogin(row);
    },

    async patchLogin(id: string, patch: LoginPatch): Promise<Login> {
      const row = await request<RawLogin>(`/v1/credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          organization_id: patch.organizationId,
          property_id: patch.propertyId || null,
        }),
      });
      return toLogin(row);
    },

    async getSettings(id: string): Promise<Settings> {
      return toSettings(await request<RawSettings>(`/v1/connections/${id}/credentials`));
    },

    async saveSettings(id: string, values: Record<string, string>): Promise<Settings> {
      return toSettings(
        await request<RawSettings>(`/v1/connections/${id}/credentials`, {
          method: "PUT",
          body: JSON.stringify({ values }),
        }),
      );
    },

    async getLoginSettings(id: string): Promise<Settings> {
      return toSettings(await request<RawSettings>(`/v1/credentials/${id}`));
    },

    async saveLoginSettings(id: string, values: Record<string, string>): Promise<Settings> {
      return toSettings(
        await request<RawSettings>(`/v1/credentials/${id}`, {
          method: "PUT",
          body: JSON.stringify({ values }),
        }),
      );
    },
  };
}

export type RunnerClient = ReturnType<typeof createRunner>;
