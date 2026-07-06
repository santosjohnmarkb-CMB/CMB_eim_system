// electron-builder afterSign hook: notarize the macOS build with Apple.
//
// This runs automatically during `electron-builder --mac`. It is a NO-OP unless
// all three Apple credentials are present in the environment, so local/dev
// builds (and CI without secrets) still succeed and simply produce a signed-but-
// not-notarized app. Set these to enable notarization:
//   APPLE_ID                      Apple developer account email
//   APPLE_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
//   APPLE_TEAM_ID                 10-char team id
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      '[notarize] Skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set. ' +
      'Build will be signed (if a Developer ID cert is available) but not notarized.',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] Submitting ${appName}.app to Apple notary service…`);

  await notarize({
    appBundleId: 'com.cmb.eim',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log(`[notarize] ${appName}.app notarized successfully.`);
};
