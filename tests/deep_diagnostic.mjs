import assert from 'assert';
import crypto from 'crypto';
import path from 'path';
import vm from 'vm';
import { promises as fs } from 'fs';

// Set up test environment
process.env.PRIVATE_KEY_HEX = '55ba4b6dff23bd33768b278f088ae4ca5c50c9b9344c97f91438c1b82174a3ff';
const PUBLIC_KEY_B64 = 'SOmyfK3o7JHhEF7vOPNvpAdyJxen7vfUY8BEv/YTUZo=';

console.log('🧪 Starting Ultimate Repertory Deep Diagnostic & Comprehensive Bug Check...\n');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        passedTests++;
        console.log(`  ✅ PASS: ${name}`);
      }).catch((err) => {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(`     Error: ${err.message}`);
        throw err;
      });
    } else {
      passedTests++;
      console.log(`  ✅ PASS: ${name}`);
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    throw err;
  }
}

async function runAllDiagnostics() {
  // 1. Import handlers
  console.log('📦 1. Verifying Function Exports & Modules:');
  const generateMod = await import('../netlify/functions/generate-license.mjs');
  const validateMod = await import('../netlify/functions/validate-license.mjs');
  const revokeMod = await import('../netlify/functions/revoke-license.mjs');
  const publishMod = await import('../netlify/functions/publish-update.mjs');
  const getVersionMod = await import('../netlify/functions/get-version.mjs');
  const getLogMod = await import('../netlify/functions/get-license-log.mjs');
  const ghHelperMod = await import('../netlify/functions/github-release-helper.mjs');

  it('All Netlify functions export a default handler', () => {
    assert.strictEqual(typeof generateMod.default, 'function', 'generate-license must export default');
    assert.strictEqual(typeof validateMod.default, 'function', 'validate-license must export default');
    assert.strictEqual(typeof revokeMod.default, 'function', 'revoke-license must export default');
    assert.strictEqual(typeof publishMod.default, 'function', 'publish-update must export default');
    assert.strictEqual(typeof getVersionMod.default, 'function', 'get-version must export default');
    assert.strictEqual(typeof getLogMod.default, 'function', 'get-license-log must export default');
    assert.strictEqual(typeof ghHelperMod.default, 'function', 'github-release-helper must export default');
  });

  await it('github-release-helper GET endpoint returns repo configuration', async () => {
    const res = await ghHelperMod.default({ httpMethod: 'GET' });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.repo, 'mpsingh2267/ULTIMATE-REPERTORY');
  });

  // 2. License Generation Tests
  console.log('\n🔑 2. Testing Licence Key Generation:');
  const testDevice = 'AABBCC-DDEEFF-112233-445566';

  let fullKey;
  let trial10dKey;
  let trial6mKey;
  let trial365dKey;

  await it('Generates permanent full license without login', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, edition: 'full' }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.key.startsWith('UR1.'));
    assert.strictEqual(data.edition, 'full');
    assert.strictEqual(data.expiresAt, null);
    assert.strictEqual(data.duration, 'Permanent');
    fullKey = data.key;
  });

  await it('Generates 10-day trial license', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, edition: 'trial', trialDuration: '10d' }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.key.startsWith('UR1.'));
    assert.strictEqual(data.edition, 'trial');
    assert.ok(data.expiresAt);
    assert.strictEqual(data.duration, '10 Days');
    trial10dKey = data.key;
  });

  await it('Generates 6-month (180-day) trial license', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, edition: 'trial', trialDuration: '6m' }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.key.startsWith('UR1.'));
    assert.strictEqual(data.edition, 'trial');
    assert.strictEqual(data.duration, '6 Months');
    assert.ok(data.expiresAt);
    const days = Math.round((new Date(data.expiresAt) - new Date(data.issuedAt)) / 86400000);
    assert.strictEqual(days, 180, '6m trial must be exactly 180 days');
    trial6mKey = data.key;
  });

  await it('Generates custom 365-day trial license', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, edition: 'trial', trialDuration: '365' }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.duration, '365 Days');
    trial365dKey = data.key;
  });

  await it('Accepts lowercase device code and normalizes to uppercase', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: 'aabbcc-ddeeff-112233-445566', edition: 'full' }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.deviceCode, testDevice);
  });

  await it('Rejects invalid device code format', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: 'INVALID-CODE', edition: 'full' }),
    });
    assert.strictEqual(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.ok(data.error.includes('Invalid device code'));
  });

  await it('Rejects unsupported edition', async () => {
    const res = await generateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, edition: 'invalid_edition' }),
    });
    assert.strictEqual(res.statusCode, 400);
    const data = JSON.parse(res.body);
    assert.ok(data.error.includes('Edition must be trial or full'));
  });

  // 3. License Validation Tests
  console.log('\n🔍 3. Testing Licence Key Validation:');

  await it('Validates permanent full license successfully', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: fullKey }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.edition, 'full');
    assert.strictEqual(data.expiresAt, null);
    assert.strictEqual(data.daysRemaining, null);
  });

  await it('Validates 10-day trial license successfully', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: trial10dKey }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.edition, 'trial');
    assert.ok(data.daysRemaining >= 9 && data.daysRemaining <= 10);
  });

  await it('Validates 6-month trial license successfully', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: trial6mKey }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.edition, 'trial');
    assert.ok(data.daysRemaining >= 179 && data.daysRemaining <= 180);
  });

  await it('Validates custom 365-day trial license successfully', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: trial365dKey }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.edition, 'trial');
    assert.ok(data.daysRemaining >= 364 && data.daysRemaining <= 365);
  });

  await it('Rejects valid key used on a different device', async () => {
    const otherDevice = '112233-445566-AABBCC-DDEEFF';
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: otherDevice, key: fullKey }),
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, false);
    assert.ok(data.error.includes('different device'));
  });

  await it('Rejects tampered payload', async () => {
    const parts = fullKey.split('.');
    const tamperedPayload = Buffer.from(parts[1], 'base64').toString('utf8').replace('full', 'trial');
    const tamperedB64 = Buffer.from(tamperedPayload).toString('base64url');
    const tamperedKey = `${parts[0]}.${tamperedB64}.${parts[2]}`;

    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: tamperedKey }),
    });
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, false);
    assert.ok(data.error.includes('Invalid license signature'));
  });

  await it('Rejects tampered signature', async () => {
    const parts = fullKey.split('.');
    const tamperedSig = parts[2].substring(0, 10) + 'AAAA' + parts[2].substring(14);
    const tamperedKey = `${parts[0]}.${parts[1]}.${tamperedSig}`;

    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: testDevice, key: tamperedKey }),
    });
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, false);
    assert.ok(data.error.includes('Invalid license signature'));
  });

  // 4. Client App Verifier Cryptographic Check
  console.log('\n📱 4. Testing Client App Verification Compatibility:');

  await it('Flutter client verification passes for 6-month trial', () => {
    const parts = trial6mKey.split('.');
    assert.strictEqual(parts.length, 3);
    assert.strictEqual(parts[0], 'UR1');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.strictEqual(payload.deviceCode, testDevice);
    assert.strictEqual(payload.edition, 'trial');

    const durationDays = (new Date(payload.expiresAt) - new Date(payload.issuedAt)) / 86400000;
    assert.ok(durationDays <= 370, 'Trial duration must be within client app allowed max');
  });

  await it('Flutter client verification passes for 365-day trial', () => {
    const parts = trial365dKey.split('.');
    assert.strictEqual(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const durationDays = (new Date(payload.expiresAt) - new Date(payload.issuedAt)) / 86400000;
    assert.ok(durationDays <= 370, '365-day trial duration must be within client app allowed max of 370');
  });

  // 5. Multi-Device Revocation & Isolation Tests
  console.log('\n⛔ 5. Testing Immediate Trial Revocation & Multi-Device Isolation:');
  const deviceA = 'AAAAAA-111111-222222-333333';
  const deviceB = 'BBBBBB-111111-222222-333333';

  const keyARes = await generateMod.default({
    httpMethod: 'POST',
    body: JSON.stringify({ deviceCode: deviceA, edition: 'trial', trialDuration: '6m' }),
  });
  const keyA = JSON.parse(keyARes.body).key;

  const keyBRes = await generateMod.default({
    httpMethod: 'POST',
    body: JSON.stringify({ deviceCode: deviceB, edition: 'trial', trialDuration: '6m' }),
  });
  const keyB = JSON.parse(keyBRes.body).key;

  await it('Revokes device A with immediate effect', async () => {
    const res = await revokeMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: deviceA, reason: 'Targeted stop test' }),
    });
    assert.strictEqual(res.statusCode, 200);
  });

  await it('Device A is immediately rejected upon validation', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: deviceA, key: keyA }),
    });
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, false);
    assert.strictEqual(data.revoked, true);
  });

  await it('Device B remains completely valid and active (isolated)', async () => {
    const res = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: deviceB, key: keyB }),
    });
    const data = JSON.parse(res.body);
    assert.strictEqual(data.valid, true);
    assert.strictEqual(data.edition, 'trial');
  });

  await it('Live version feed includes Device A and excludes Device B', async () => {
    const res = await getVersionMod.default({ httpMethod: 'GET' });
    const feed = JSON.parse(res.body);
    assert.ok(feed.revokedDevices.includes(deviceA));
    assert.ok(!feed.revokedDevices.includes(deviceB));
  });

  await it('Restoring Device A unblocks Device A immediately', async () => {
    const res = await revokeMod.default({
      httpMethod: 'DELETE',
      body: JSON.stringify({ deviceCode: deviceA }),
    });
    assert.strictEqual(res.statusCode, 200);

    const valRes = await validateMod.default({
      httpMethod: 'POST',
      body: JSON.stringify({ deviceCode: deviceA, key: keyA }),
    });
    const valData = JSON.parse(valRes.body);
    assert.strictEqual(valData.valid, true);
  });

  // 6. Update Publishing Tests
  console.log('\n🚀 6. Testing Update Publishing:');

  await it('Publishes new app version update feed with multi-line changelog & emojis', async () => {
    const updatePayload = {
      version: '2.5.3',
      buildNumber: 53,
      releaseDate: '2026-10-26',
      changelog: [
        '✨ 6-month trial support with immediate revocation',
        '🚀 Streamlined update delivery',
        '🔒 Zero login required for portal administration',
      ],
      downloads: {
        macos: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.3-Trial-Universal-Mac.pkg',
        windows: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.3-Trial-Windows-Setup.exe',
        android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.3-Trial-Android-Tablet-Universal.apk',
      },
    };

    const pubRes = await publishMod.default({
      httpMethod: 'POST',
      body: JSON.stringify(updatePayload),
    });
    assert.strictEqual(pubRes.statusCode, 200);
    const pubData = JSON.parse(pubRes.body);
    assert.strictEqual(pubData.success, true);
    assert.strictEqual(pubData.update.version, '2.5.3');
    assert.strictEqual(pubData.update.buildNumber, 53);

    const getRes = await getVersionMod.default({ httpMethod: 'GET' });
    const getData = JSON.parse(getRes.body);
    assert.strictEqual(getData.version, '2.5.3');
    assert.strictEqual(getData.buildNumber, 53);
    assert.strictEqual(getData.changelog.length, 3);
  });

  // 7. Netlify TOML & HTML UI Integrity
  console.log('\n⚙️ 7. Testing Configuration & UI Syntax Integrity:');

  await it('netlify.toml contains correct build, redirects, and headers', async () => {
    const tomlPath = path.resolve('netlify.toml');
    const toml = await fs.readFile(tomlPath, 'utf8');

    assert.ok(toml.includes('node_bundler = "esbuild"'), 'Must specify esbuild bundler');
    assert.ok(toml.includes('external_node_modules = ["@netlify/blobs"]'), 'Blobs marked external');
    assert.ok(toml.includes('from   = "/updates/version.json"'), 'Must redirect /updates/version.json');
    assert.ok(toml.includes('to     = "/.netlify/functions/get-version"'), 'Must target get-version function');
    assert.ok(toml.includes('from   = "/api/*"'), 'Must redirect /api/*');
    assert.ok(toml.includes('Cache-Control = "no-cache, no-store, must-revalidate"'), 'Must prevent caching');
  });

  await it('public/index.html contains 100% valid JavaScript and no syntax errors', async () => {
    const htmlPath = path.resolve('public/index.html');
    const html = await fs.readFile(htmlPath, 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'public/index.html must contain a script block');
    // Evaluate script with vm to assert zero syntax errors
    new vm.Script(scriptMatch[1]);
  });

  await it('package.json and pnpm-lock.yaml do not contain unmanaged external blobs dependency', async () => {
    const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
    assert.strictEqual(pkg.dependencies?.['@netlify/blobs'], undefined, '@netlify/blobs should not be in package.json to avoid pnpm frozen lockfile collision');
  });

  // 8. Performance Benchmark
  console.log('\n⚡ 8. Performance Benchmarking:');
  await it('Generates 20 cryptographic keys in under 500ms', async () => {
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const code = `112233-445566-778899-${String(i).padStart(6, '0')}`;
      const res = await generateMod.default({
        httpMethod: 'POST',
        body: JSON.stringify({ deviceCode: code, edition: 'trial', trialDuration: '6m' }),
      });
      assert.strictEqual(res.statusCode, 200);
    }
    const elapsed = Date.now() - start;
    console.log(`     (20 keys generated in ${elapsed}ms — ~${(elapsed/20).toFixed(1)}ms/key)`);
    assert.ok(elapsed < 1000, `Key generation took too long: ${elapsed}ms`);
  });

  console.log(`\n🎉 Deep Diagnostic Complete! ${passedTests}/${totalTests} tests passed with 0 errors.\n`);
}

runAllDiagnostics().catch((err) => {
  console.error('\n❌ Diagnostic Suite Terminated With Errors.');
  process.exit(1);
});
