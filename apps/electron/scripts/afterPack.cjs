/**
 * electron-builder afterPack hook
 *
 * Copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file is compiled locally using actool with the
 * macOS 26 SDK (not available in CI), then committed to the repo.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');

module.exports = async function afterPack(context) {
  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  if (productFilename === 'Artist OS') {
    installArtistVoiceCore(context);
    return;
  }
  if (productFilename !== 'Runner') {
    console.log(`Skipping Runner Liquid Glass assets for ${productFilename}`);
    return;
  }

  const appPath = context.appOutDir;
  const resourcesDir = path.join(appPath, `${productFilename}.app`, 'Contents', 'Resources');
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};

function installArtistVoiceCore(context) {
  const source = path.join(context.packager.projectDir, '.voice-core-release', 'resources', 'voice-core');
  const resources = path.join(context.appOutDir, 'Artist OS.app', 'Contents', 'Resources');
  const destination = path.join(resources, 'voice-core');
  const helper = path.join(source, 'bin', 'VoiceCoreMoonshineHost.app');
  const catalog = path.join(source, 'moonshine-release-catalog-v1.json');
  if (!fs.existsSync(helper) || !fs.existsSync(catalog)) {
    throw new Error('Signed Artist OS Voice Core release resources were not prepared');
  }
  const parsedCatalog = JSON.parse(fs.readFileSync(catalog, 'utf8'));
  if (parsedCatalog?.schemaVersion !== 1 || !Array.isArray(parsedCatalog.entries) || parsedCatalog.entries.length !== 0) {
    throw new Error('Artist OS Moonshine release catalog must remain blocked until production model publication');
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', helper], { stdio: 'inherit' });
  const inspected = spawnSync('codesign', ['-d', '--verbose=4', helper], { encoding: 'utf8' });
  if (inspected.status !== 0
    || !inspected.stderr.includes('Identifier=com.findmikeymike.artistos.voicecore.moonshine\n')
    || !inspected.stderr.includes('TeamIdentifier=6TWTVSA34P\n')) {
    throw new Error('Artist OS Moonshine helper has the wrong signed identity');
  }
  const entitlementInspection = spawnSync('codesign', ['-d', '--entitlements', ':-', helper], { encoding: 'utf8' });
  const entitlementText = `${entitlementInspection.stdout}${entitlementInspection.stderr}`;
  if (entitlementInspection.status !== 0
    || !entitlementText.includes('<string>6TWTVSA34P.com.findmikeymike.artistos.voicecore.moonshine</string>')
    || entitlementText.includes('<string>6TWTVSA34P.*</string>')) {
    throw new Error('Artist OS Moonshine helper lacks its exact Keychain entitlement');
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  console.log('Installed the independently signed Artist OS Moonshine helper');
}
