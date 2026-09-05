import express from "express";
import {
  buildVoiceCoreSessionKeyring,
  buildVoiceCoreSessionResponse,
  DEFAULT_REQUIRED_SCOPE,
  readVoiceCoreSessionHeader,
  verifyVoiceCoreSessionToken,
} from "./voicecore-session.mjs";
import { decideVoiceCoreEntitlement } from "./voicecore-entitlement.mjs";

const app = express();
app.use(express.json());

function getSecret() {
  const secret = process.env.VOICECORE_WEB_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing VOICECORE_WEB_SESSION_SECRET");
  }
  return secret;
}

function getRequiredScope() {
  return process.env.VOICECORE_WEB_REQUIRED_SCOPE?.trim() || DEFAULT_REQUIRED_SCOPE;
}

function getKeyId() {
  return process.env.VOICECORE_WEB_SESSION_KEY_ID?.trim() || "example-current";
}

function getSessionKeys() {
  return buildVoiceCoreSessionKeyring({
    currentKeyId: getKeyId(),
    currentSecret: getSecret(),
    previousKeysJson: process.env.VOICECORE_WEB_SESSION_PREVIOUS_KEYS_JSON,
  });
}

app.post("/api/voicecore/session", (req, res) => {
  // Replace both stubs with your authenticated subject and entitlement-store record.
  const subject = "acct_demo";
  const workspaceId =
    typeof req.body?.workspace_id === "string" ? req.body.workspace_id.trim() : undefined;
  const appVersion =
    typeof req.body?.app_version === "string" ? req.body.app_version.trim() : undefined;

  const now = Math.floor(Date.now() / 1000);
  const entitlementDecision = decideVoiceCoreEntitlement({
    authenticatedSubject: subject,
    workspaceId,
    expectedAppId: "com.example.app",
    sdkReleaseUnix: now,
    requiredFeatures: ["web_runtime"],
    revoked: false,
    nowSeconds: now,
    entitlementClaims: {
      schema_version: 2,
      license_id: "lic_example_only",
      customer_id: "customer_example_only",
      product: "convo-sdk",
      tier: "development",
      license_kind: "term",
      app_ids: ["com.example.app"],
      features: ["voice_runtime", "web_runtime"],
      issued_at: now,
      not_before: now,
      runtime_expires_at: now + 3_600,
      grace_expires_at: now + 7_200,
      maintenance_expires_at: now + 86_400,
      support_expires_at: now + 86_400,
    },
  });
  if (entitlementDecision.decision !== "allow") {
    res.status(403).json({ error: `Voice Core entitlement denied: ${entitlementDecision.reason}` });
    return;
  }
  const payload = buildVoiceCoreSessionResponse({
    secret: getSecret(),
    keyId: getKeyId(),
    entitlementDecision,
    appVersion,
    nowSeconds: now,
  });

  res.json(payload);
});

function requireVoiceCoreSession(req, res, next) {
  const token = readVoiceCoreSessionHeader(req.headers);
  const validation = token
    ? verifyVoiceCoreSessionToken({
        token,
        keys: getSessionKeys(),
        requiredScope: getRequiredScope(),
      })
    : { ok: false, reason: "missing session token" };

  if (!validation.ok) {
    res.status(401).json({
      error: `VoiceCore web session rejected: ${validation.reason}`,
    });
    return;
  }

  req.voicecoreSession = validation.claims;
  next();
}

app.use("/api/openai", requireVoiceCoreSession);
app.use("/api/together", requireVoiceCoreSession);
app.use("/api/groq", requireVoiceCoreSession);
app.use("/api/openrouter", requireVoiceCoreSession);
app.use("/api/custom", requireVoiceCoreSession);
app.use("/api/assemblyai", requireVoiceCoreSession);
app.use("/api/inworld", requireVoiceCoreSession);

app.listen(4174, () => {
  console.log("VoiceCore web example server listening on http://127.0.0.1:4174");
});
