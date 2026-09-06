#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const bundleId = required(args, "bundle-id");
const identity = required(args, "identity");
const host = regularFile(required(args, "host"));
const nativeLibrary = regularFile(required(args, "native-library"));
const ortLibrary = regularFile(required(args, "ort-library"));
const profile = regularFile(required(args, "profile"));
const output = path.resolve(required(args, "output"));

if (!/^[A-Za-z0-9.-]{1,255}$/.test(bundleId)) fail("invalid helper bundle identifier");
if (existsSync(output)) fail(`output already exists: ${output}`);

const profilePlist = execFileSync("security", ["cms", "-D", "-i", profile]);
const temporary = mkdtempSync(path.join(tmpdir(), "voicecore-moonshine-signing-"));
const decodedProfilePath = path.join(temporary, "profile.plist");
writeFileSync(decodedProfilePath, profilePlist, { mode: 0o600 });
const profileJson = execFileSync(
  "plutil",
  ["-extract", "Entitlements", "json", "-o", "-", decodedProfilePath],
  { encoding: "utf8" },
);
const entitlements = JSON.parse(profileJson);
const teamId = entitlements?.["com.apple.developer.team-identifier"];
const applicationIdentifier = entitlements?.["com.apple.application-identifier"];
const accessGroups = entitlements?.["keychain-access-groups"];
if (!/^[A-Z0-9]{10}$/.test(teamId)
  || applicationIdentifier !== `${teamId}.${bundleId}`
  || !Array.isArray(accessGroups)
  || !accessGroups.some((group) => group === `${teamId}.${bundleId}` || group === `${teamId}.*`)) {
  fail("provisioning profile does not authorize this helper's Keychain identity");
}

const contents = path.join(output, "Contents");
const macos = path.join(contents, "MacOS");
const libraries = path.join(contents, "lib");
mkdirSync(macos, { recursive: true, mode: 0o755 });
mkdirSync(libraries, { recursive: true, mode: 0o755 });
const packagedHost = path.join(macos, "voice-core-moonshine-host");
const packagedNativeLibrary = path.join(libraries, "libvoice_moonshine_stt.dylib");
const packagedOrtLibrary = path.join(libraries, "libonnxruntime.1.23.2.dylib");
copyFileSync(host, packagedHost);
copyFileSync(nativeLibrary, packagedNativeLibrary);
copyFileSync(ortLibrary, packagedOrtLibrary);
copyFileSync(profile, path.join(contents, "embedded.provisionprofile"));
chmodSync(packagedHost, 0o755);

writeFileSync(path.join(contents, "Info.plist"), plist({ bundleId }), { mode: 0o644 });
const entitlementsPath = path.join(temporary, "entitlements.plist");
// A wildcard profile authorizes narrower child entitlements. Never stamp the
// wildcard itself into the helper: each consuming app gets one exact Keychain
// access group, so sibling products signed by the same team cannot share it.
writeFileSync(entitlementsPath, entitlementPlist({
  applicationIdentifier,
  teamId,
  accessGroups: [applicationIdentifier],
}), { mode: 0o600 });

for (const library of [packagedOrtLibrary, packagedNativeLibrary]) {
  execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", identity, library], { stdio: "inherit" });
}
execFileSync("codesign", [
  "--force",
  "--options", "runtime",
  "--timestamp",
  "--identifier", bundleId,
  "--entitlements", entitlementsPath,
  "--sign", identity,
  output,
], { stdio: "inherit" });
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", output], { stdio: "inherit" });
const signature = spawnSync("codesign", ["-d", "--verbose=4", output], { encoding: "utf8" });
if (signature.status !== 0
  || !signature.stderr.includes(`Identifier=${bundleId}\n`)
  || !signature.stderr.includes(`TeamIdentifier=${teamId}\n`)) {
  fail("signed helper identity does not match its provisioning profile");
}
const signedEntitlements = execFileSync(
  "codesign",
  ["-d", "--entitlements", ":-", "--xml", output],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const signedEntitlementsPath = path.join(temporary, "signed-entitlements.plist");
writeFileSync(signedEntitlementsPath, signedEntitlements, { mode: 0o600 });
const signedAccessGroups = JSON.parse(execFileSync(
  "plutil",
  ["-extract", "keychain-access-groups", "json", "-o", "-", signedEntitlementsPath],
  { encoding: "utf8" },
));
if (JSON.stringify(signedAccessGroups) !== JSON.stringify([applicationIdentifier])) {
  fail("signed helper Keychain access group is not app-exact");
}
process.stdout.write(`Packaged signed Moonshine helper: ${output}\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("arguments must be --name value pairs");
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (!value) fail(`missing --${key}`);
  return value;
}

function regularFile(value) {
  const resolved = path.resolve(value);
  const metadata = lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`input must be a regular file: ${resolved}`);
  return resolved;
}

function plist({ bundleId }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>en</string>
<key>CFBundleExecutable</key><string>voice-core-moonshine-host</string>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>Voice Core Moonshine Host</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>
`;
}

function entitlementPlist({ applicationIdentifier, teamId, accessGroups }) {
  const groups = accessGroups.map((group) => `<string>${group}</string>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.application-identifier</key><string>${applicationIdentifier}</string>
<key>com.apple.developer.team-identifier</key><string>${teamId}</string>
<key>keychain-access-groups</key><array>${groups}</array>
</dict></plist>
`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
