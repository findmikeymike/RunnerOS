export const ENTITLEMENT_DECISION_SCHEMA_VERSION: 1;
export const ENTITLEMENT_PRODUCT: "convo-sdk";

export type EntitlementClaimsV2 = {
  schema_version: 2;
  license_id: string;
  customer_id: string;
  product: "convo-sdk";
  tier: string;
  license_kind: "term" | "perpetual";
  app_ids: string[];
  features: string[];
  issued_at: number;
  not_before: number;
  runtime_expires_at: number | null;
  grace_expires_at: number | null;
  maintenance_expires_at: number;
  support_expires_at: number | null;
};

export type EntitlementDecision = Readonly<{
  schema_version: 1;
  decision: "allow";
  reason: null;
  subject: string;
  workspace_id: string | null;
  license_id: string;
  customer_id: string;
  tier: string;
  license_kind: "term" | "perpetual";
  runtime_state: "active" | "grace" | "perpetual";
  valid_until: number | null;
  features: readonly string[];
  evaluated_at: number;
}>;

export type DeniedEntitlementDecision = Readonly<{
  schema_version: 1;
  decision: "deny";
  reason: string;
  subject: string;
  workspace_id: string | null;
  license_id: string;
  evaluated_at: number;
}>;

export function decideVoiceCoreEntitlement(args: {
  authenticatedSubject: string;
  workspaceId?: string;
  expectedAppId?: string;
  sdkReleaseUnix: number;
  entitlementClaims: EntitlementClaimsV2;
  revoked: boolean;
  requiredFeatures?: string[];
  nowSeconds?: number;
}): EntitlementDecision | DeniedEntitlementDecision;

export function requireEntitlementDecision(
  decision: unknown,
  options?: { requiredFeature?: string; nowSeconds?: number; maximumAgeSeconds?: number },
): EntitlementDecision;
