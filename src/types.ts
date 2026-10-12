export type Scope = {
  organizationId?: string;
  propertyId?: string;
};

export type Connector = {
  id: string;
  type: string;
  name: string;
  organizationId: string;
  propertyId: string | null;
  productionPropertyId: string | null;
  loginId: string | null;
  enabled: boolean;
  authStatus: string;
  config: Record<string, unknown>;
};

export type ConnectorType = {
  key: string;
  name: string;
  settings: SettingField[];
};

export type SettingField = {
  key: string;
  title: string;
  secret: boolean;
};

export type Login = {
  id: string;
  name: string;
  organizationId: string;
  propertyId: string | null;
  kind: "password" | "browser_session";
  authStatus: string;
  connectorIds: string[];
};

export type Settings = {
  values: Record<string, string>;
  savedSecrets: string[];
};

export type ConnectorInput = {
  id: string;
  type: string;
  name: string;
  organizationId: string;
  propertyId?: string | null;
  productionPropertyId?: string | null;
  loginId?: string | null;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type ConnectorPatch = {
  name?: string;
  organizationId?: string;
  propertyId?: string | null;
  productionPropertyId?: string | null;
  loginId?: string | null;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type LoginInput = {
  name: string;
  organizationId: string;
  propertyId?: string | null;
  username?: string;
  password?: string;
};

export type LoginPatch = {
  organizationId: string;
  propertyId?: string | null;
};
