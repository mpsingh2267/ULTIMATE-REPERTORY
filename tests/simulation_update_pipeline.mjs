import assert from 'assert';
import path from 'path';

console.log('🚀 Running Comprehensive Update Pipeline Simulation (Site -> Netlify Free -> Flutter App)...\n');

// Import actual Netlify serverless functions to simulate live production pipeline
const getVersionMod = await import('../netlify/functions/get-version.mjs');
const publishMod = await import('../netlify/functions/publish-update.mjs');

// 1. Flutter App Update Logic (exact implementation from lib/main.dart)

// A. Legacy Client (installed build 178 / 179 before any patches)
function legacyCustomerTrialUpdateUrl(downloads, platform, edition = '') {
  if (!downloads || typeof downloads !== 'object') return '';
  const url =
    downloads[`${platform}_trial`] ||
    (edition === 'trial' ? downloads[platform] : null) ||
    '';
  try {
    const uri = new URL(url);
    return uri.protocol === 'https:' && uri.host ? url : '';
  } catch {
    return '';
  }
}

// B. Updated Client (with fallback to downloads[platform])
function modernCustomerTrialUpdateUrl(downloads, platform, edition = '') {
  if (!downloads || typeof downloads !== 'object') return '';
  const url =
    downloads[`${platform}_trial`] ||
    (edition === 'trial' ? downloads[platform] : null) ||
    downloads[platform] ||
    '';
  try {
    const uri = new URL(url);
    return uri.protocol === 'https:' && uri.host ? url : '';
  } catch {
    return '';
  }
}

function simulateAppUpdateCheck({
  feedJson,
  currentAppBuild,
  platform,
  deviceCode,
  isLegacyClient = false,
}) {
  // Check kill-switch revocation
  const revokedDevices = new Set((feedJson.revokedDevices || []).map((d) => String(d).toUpperCase().trim()));
  if (deviceCode && revokedDevices.has(String(deviceCode).toUpperCase().trim())) {
    return {
      action: 'KILL_SWITCH_REVOKE',
      licenseDeleted: true,
      updateAvailable: false,
      reason: 'Device code revoked by administrator',
    };
  }

  // Parse editions
  const editions = feedJson.editions;
  const trial = editions ? editions.trial : null;
  const selected = trial
    ? { ...trial, edition: 'trial' }
    : { ...feedJson, edition: feedJson.edition || '' };

  const remote = {
    version: String(selected.version || ''),
    buildNumber: parseInt(selected.buildNumber, 10) || 0,
    downloads: selected.downloads || {},
    edition: String(selected.edition || ''),
    changelog: Array.isArray(selected.changelog)
      ? selected.changelog
      : (typeof selected.changelog === 'string' ? [selected.changelog] : []),
  };

  const getUrlFn = isLegacyClient ? legacyCustomerTrialUpdateUrl : modernCustomerTrialUpdateUrl;
  const downloadUrl = getUrlFn(remote.downloads, platform, remote.edition);

  if (!downloadUrl) {
    return {
      action: 'NO_UPDATE',
      updateAvailable: false,
      reason: `Download URL for platform "${platform}" is empty or invalid`,
    };
  }

  if (remote.buildNumber > currentAppBuild) {
    return {
      action: 'SHOW_UPDATE_DIALOG',
      updateAvailable: true,
      version: remote.version,
      buildNumber: remote.buildNumber,
      downloadUrl,
      changelog: remote.changelog,
    };
  }

  return {
    action: 'NO_UPDATE',
    updateAvailable: false,
    reason: `App build ${currentAppBuild} is already up to date with remote build ${remote.buildNumber}`,
  };
}

// 2. Run Simulations
async function runSimulations() {
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`  ✅ SIMULATION PASS: ${name}`);
    } catch (err) {
      console.error(`  ❌ SIMULATION FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      throw err;
    }
  }

  // Sample production feed produced by get-version
  const liveFeed2_16_20 = {
    version: '2.16.20',
    buildNumber: 180,
    edition: 'trial',
    releaseDate: '2026-10-26',
    changelog: ['Major performance enhancement', '6-month extended trial support', 'Streamlined updates'],
    downloads: {
      macos: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
      macos_trial: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
      windows: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Windows.exe',
      windows_trial: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Windows.exe',
      android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Android.apk',
      android_trial: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Android.apk',
    },
    editions: {
      trial: {
        version: '2.16.20',
        buildNumber: 180,
        releaseDate: '2026-10-26',
        changelog: ['Major performance enhancement', '6-month extended trial support', 'Streamlined updates'],
        downloads: {
          macos: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
          macos_trial: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
          windows: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Windows.exe',
          windows_trial: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Windows.exe',
          android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Android.apk',
          android_trial: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-Trial-Android.apk',
        },
      },
    },
    revokedDevices: ['REVOKED-DEVICE-01'],
    revokedLicenses: [],
  };

  console.log('📱 Scenario 1: Customer on v2.5.2 (Build 52) launches macOS app');
  test('v2.5.2 app detects v2.16.20 (Build 180) update and offers macOS download', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 52,
      platform: 'macos',
      deviceCode: 'NORMAL-DEVICE-01',
    });
    assert.strictEqual(res.action, 'SHOW_UPDATE_DIALOG');
    assert.strictEqual(res.updateAvailable, true);
    assert.strictEqual(res.version, '2.16.20');
    assert.strictEqual(res.buildNumber, 180);
    assert.ok(res.downloadUrl.includes('Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg'));
  });

  console.log('\n📱 Scenario 2: Legacy client (without Dart fallback) on macOS launches app');
  test('Legacy build 177 receives update via macos_trial key and edition: trial', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 177,
      platform: 'macos',
      deviceCode: 'NORMAL-DEVICE-01',
      isLegacyClient: true,
    });
    assert.strictEqual(res.action, 'SHOW_UPDATE_DIALOG');
    assert.strictEqual(res.updateAvailable, true);
    assert.strictEqual(res.buildNumber, 180);
    assert.ok(res.downloadUrl.includes('.pkg'));
  });

  console.log('\n📱 Scenario 3: User machine with installed /Applications/Ultimate Repertory Trial.app (Build 179)');
  test('Currently installed Build 179 app detects Build 180 and shows update dialog', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 179,
      platform: 'macos',
      deviceCode: 'NORMAL-DEVICE-01',
      isLegacyClient: true,
    });
    assert.strictEqual(res.action, 'SHOW_UPDATE_DIALOG');
    assert.strictEqual(res.updateAvailable, true);
    assert.strictEqual(res.version, '2.16.20');
    assert.strictEqual(res.buildNumber, 180);
  });

  console.log('\n📱 Scenario 4: User machine already at latest build (Build 180)');
  test('Build 180 app silently passes without prompt when remote is Build 180', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 180,
      platform: 'macos',
      deviceCode: 'NORMAL-DEVICE-01',
    });
    assert.strictEqual(res.action, 'NO_UPDATE');
    assert.strictEqual(res.updateAvailable, false);
    assert.ok(res.reason.includes('already up to date'));
  });

  console.log('\n📱 Scenario 5: Customer on Windows platform launches legacy app');
  test('Windows legacy app receives Windows download installer URL', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 52,
      platform: 'windows',
      deviceCode: 'NORMAL-DEVICE-01',
      isLegacyClient: true,
    });
    assert.strictEqual(res.action, 'SHOW_UPDATE_DIALOG');
    assert.ok(res.downloadUrl.endsWith('.exe'));
  });

  console.log('\n📱 Scenario 6: Customer on Android platform launches legacy app');
  test('Android legacy app receives Android download installer URL', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 52,
      platform: 'android',
      deviceCode: 'NORMAL-DEVICE-01',
      isLegacyClient: true,
    });
    assert.strictEqual(res.action, 'SHOW_UPDATE_DIALOG');
    assert.ok(res.downloadUrl.endsWith('.apk'));
  });

  console.log('\n⛔ Scenario 7: Device has been revoked by admin');
  test('Revoked device triggers immediate kill-switch and deletes licence file', () => {
    const res = simulateAppUpdateCheck({
      feedJson: liveFeed2_16_20,
      currentAppBuild: 52,
      platform: 'macos',
      deviceCode: 'REVOKED-DEVICE-01',
    });
    assert.strictEqual(res.action, 'KILL_SWITCH_REVOKE');
    assert.strictEqual(res.licenseDeleted, true);
    assert.strictEqual(res.updateAvailable, false);
  });

  console.log('\n🌐 Scenario 8: End-to-End Pipeline (Site publish -> get-version feed -> app check)');
  await (async () => {
    total++;
    try {
      // 1. Admin fills in form with basic keys (like Downloads/version.json format)
      const inputPayload = {
        version: '2.16.20',
        buildNumber: 180,
        releaseDate: '2026-10-26',
        changelog: [
          '✨ 6-month trial support with immediate revocation',
          '🚀 Streamlined update delivery for Apple Silicon and all platforms',
          '🔒 Zero login required for portal administration'
        ],
        downloads: {
          macos: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
          windows: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.2-Trial-Windows-Setup.exe',
          android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.2-Trial-Android-Tablet-Universal.apk',
        },
      };

      // 2. publish-update processes and formats the feed
      const pubRes = await publishMod.default({
        httpMethod: 'POST',
        body: JSON.stringify(inputPayload),
      });
      assert.strictEqual(pubRes.statusCode, 200);

      // 3. get-version normalizes and serves the feed to clients
      const getRes = await getVersionMod.default({ httpMethod: 'GET' });
      assert.strictEqual(getRes.statusCode, 200);
      const servedFeed = JSON.parse(getRes.body);

      // 4. Client app on macOS, Windows, and Android verifies update
      const macResult = simulateAppUpdateCheck({
        feedJson: servedFeed,
        currentAppBuild: 179, // user's local installed app build
        platform: 'macos',
        deviceCode: 'TEST-MAC-01',
        isLegacyClient: true, // test against unpatched legacy client logic
      });
      assert.strictEqual(macResult.action, 'SHOW_UPDATE_DIALOG');
      assert.strictEqual(macResult.version, '2.16.20');
      assert.strictEqual(macResult.buildNumber, 180);
      assert.ok(macResult.downloadUrl.includes('.pkg'));

      const winResult = simulateAppUpdateCheck({
        feedJson: servedFeed,
        currentAppBuild: 179,
        platform: 'windows',
        deviceCode: 'TEST-WIN-01',
        isLegacyClient: true,
      });
      assert.strictEqual(winResult.action, 'SHOW_UPDATE_DIALOG');
      assert.ok(winResult.downloadUrl.includes('.exe'));

      const androidResult = simulateAppUpdateCheck({
        feedJson: servedFeed,
        currentAppBuild: 179,
        platform: 'android',
        deviceCode: 'TEST-AND-01',
        isLegacyClient: true,
      });
      assert.strictEqual(androidResult.action, 'SHOW_UPDATE_DIALOG');
      assert.ok(androidResult.downloadUrl.includes('.apk'));

      passed++;
      console.log('  ✅ SIMULATION PASS: End-to-end site publish -> Netlify feed -> Flutter app across macOS, Windows, Android');
    } catch (err) {
      console.error('  ❌ SIMULATION FAIL: End-to-end site publish -> Netlify feed -> Flutter app');
      console.error(`     Error: ${err.message}`);
      throw err;
    }
  })();

  console.log(`\n🎉 All ${passed}/${total} Comprehensive Simulations Succeeded 100%!\n`);
}

runSimulations().catch((err) => {
  console.error(err);
  process.exit(1);
});
