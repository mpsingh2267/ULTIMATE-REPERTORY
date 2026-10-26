/**
 * Netlify Function: revoke-license
 *
 * POST /api/revoke-license
 * Body:
 *   {
 *     "deviceCode": "AABBCC-DDEEFF-112233-445566",
 *     "licenseId": "optional-uuid",
 *     "reason": "optional reason string"
 *   }
 *
 * GET /api/revoke-license
 * Returns the current list of revoked devices and license IDs.
 *
 * DELETE /api/revoke-license
 * Body:
 *   {
 *     "deviceCode": "AABBCC-DDEEFF-112233-445566"
 *   }
 */

import { promises as fs } from 'fs';
import path from 'path';

async function getBlobsStore(name) {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore(name);
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // GET: Return all active revocations
  if (event.httpMethod === 'GET') {
    try {
      let revocations = [];
      const store = await getBlobsStore('license-keys');
      if (store) {
        const raw = await store.get('revocations.json');
        revocations = raw ? JSON.parse(raw) : [];
      } else {
        // Fallback to local version.json file
        try {
          const localFilePath = path.resolve(process.cwd(), 'public/updates/version.json');
          const fileData = await fs.readFile(localFilePath, 'utf8');
          const localObj = JSON.parse(fileData);
          revocations = (localObj.revokedDevices || []).map((d) => ({
            deviceCode: d,
            revokedAt: localObj.publishedAt || new Date().toISOString(),
          }));
        } catch {}
      }
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revocations }),
      };
    } catch (e) {
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revocations: [], error: e.message }),
      };
    }
  }

  // POST or DELETE
  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const normalizedDeviceCode = String(body.deviceCode ?? '').trim().toUpperCase();
  const licenseId = String(body.licenseId ?? '').trim();
  const reason = String(body.reason ?? 'Stopped by administrator').trim();

  if (!normalizedDeviceCode && !licenseId) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Device Code or License ID is required' }) };
  }

  try {
    const store = await getBlobsStore('license-keys');

    if (event.httpMethod === 'DELETE') {
      if (store) {
        try {
          const raw = await store.get('revocations.json');
          let revocations = raw ? JSON.parse(raw) : [];
          revocations = revocations.filter((r) => {
            if (normalizedDeviceCode && r.deviceCode === normalizedDeviceCode) return false;
            if (licenseId && r.licenseId === licenseId) return false;
            return true;
          });
          await store.set('revocations.json', JSON.stringify(revocations, null, 2));

          // Restore key-log.json status to Active
          const rawLog = await store.get('key-log.json');
          if (rawLog) {
            const logArray = JSON.parse(rawLog);
            logArray.forEach((item) => {
              if (
                (normalizedDeviceCode && item.deviceCode === normalizedDeviceCode) ||
                (licenseId && item.licenseId === licenseId)
              ) {
                item.status = 'Active';
                delete item.revokedAt;
              }
            });
            await store.set('key-log.json', JSON.stringify(logArray, null, 2));
          }

          // Remove from update feed in Blobs
          const updateStore = await getBlobsStore('updates');
          if (updateStore) {
            const rawVersion = await updateStore.get('version.json');
            if (rawVersion) {
              const versionObj = JSON.parse(rawVersion);
              if (Array.isArray(versionObj.revokedDevices) && normalizedDeviceCode) {
                versionObj.revokedDevices = versionObj.revokedDevices.filter((d) => d.toUpperCase() !== normalizedDeviceCode);
              }
              if (Array.isArray(versionObj.revokedLicenses) && licenseId) {
                versionObj.revokedLicenses = versionObj.revokedLicenses.filter((l) => l !== licenseId);
              }
              await updateStore.set('version.json', JSON.stringify(versionObj, null, 2));
            }
          }
        } catch (storeErr) {
          console.error('Blobs un-revocation error:', storeErr);
        }
      }

      // Always sync local version.json file if present
      try {
        const localFilePath = path.resolve(process.cwd(), 'public/updates/version.json');
        const fileData = await fs.readFile(localFilePath, 'utf8');
        const localObj = JSON.parse(fileData);
        if (Array.isArray(localObj.revokedDevices) && normalizedDeviceCode) {
          localObj.revokedDevices = localObj.revokedDevices.filter((d) => d.toUpperCase() !== normalizedDeviceCode);
        }
        if (Array.isArray(localObj.revokedLicenses) && licenseId) {
          localObj.revokedLicenses = localObj.revokedLicenses.filter((l) => l !== licenseId);
        }
        await fs.writeFile(localFilePath, JSON.stringify(localObj, null, 2), 'utf8');
      } catch {}

      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'Revocation removed and trial restored' }),
      };
    }

    if (event.httpMethod === 'POST') {
      const revokedAt = new Date().toISOString();
      const revocationEntry = {
        deviceCode: normalizedDeviceCode || null,
        licenseId: licenseId || null,
        revokedAt,
        reason,
      };

      if (store) {
        try {
          const raw = await store.get('revocations.json');
          let revocations = raw ? JSON.parse(raw) : [];
          // Avoid duplicates
          revocations = revocations.filter(
            (r) =>
              (!normalizedDeviceCode || r.deviceCode !== normalizedDeviceCode) &&
              (!licenseId || r.licenseId !== licenseId)
          );
          revocations.unshift(revocationEntry);
          await store.set('revocations.json', JSON.stringify(revocations, null, 2));

          // Update key-log.json status if found
          const rawLog = await store.get('key-log.json');
          if (rawLog) {
            const logArray = JSON.parse(rawLog);
            logArray.forEach((item) => {
              if (
                (normalizedDeviceCode && item.deviceCode === normalizedDeviceCode) ||
                (licenseId && item.licenseId === licenseId)
              ) {
                item.status = 'Revoked';
                item.revokedAt = revokedAt;
              }
            });
            await store.set('key-log.json', JSON.stringify(logArray, null, 2));
          }

          // Sync into update feed (version.json in 'updates' store)
          const updateStore = await getBlobsStore('updates');
          if (updateStore) {
            const rawVersion = await updateStore.get('version.json');
            let versionObj = rawVersion ? JSON.parse(rawVersion) : {};
            const revokedDevices = new Set(versionObj.revokedDevices || []);
            const revokedLicenses = new Set(versionObj.revokedLicenses || []);
            if (normalizedDeviceCode) revokedDevices.add(normalizedDeviceCode);
            if (licenseId) revokedLicenses.add(licenseId);

            versionObj.revokedDevices = Array.from(revokedDevices);
            versionObj.revokedLicenses = Array.from(revokedLicenses);
            await updateStore.set('version.json', JSON.stringify(versionObj, null, 2));
          }
        } catch (storeErr) {
          console.error('Blobs revocation error:', storeErr);
        }
      }

      // Always sync local version.json file if present
      try {
        const localFilePath = path.resolve(process.cwd(), 'public/updates/version.json');
        const fileData = await fs.readFile(localFilePath, 'utf8');
        const localObj = JSON.parse(fileData);
        const devSet = new Set((localObj.revokedDevices || []).map((d) => d.toUpperCase()));
        const licSet = new Set(localObj.revokedLicenses || []);
        if (normalizedDeviceCode) devSet.add(normalizedDeviceCode);
        if (licenseId) licSet.add(licenseId);
        localObj.revokedDevices = Array.from(devSet);
        localObj.revokedLicenses = Array.from(licSet);
        await fs.writeFile(localFilePath, JSON.stringify(localObj, null, 2), 'utf8');
      } catch {}

      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: `Trial revoked immediately for device ${normalizedDeviceCode || licenseId}`,
          revokedAt,
          entry: revocationEntry,
        }),
      };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('Revocation error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Revocation failed: ${err.message}` }),
    };
  }
};

export default handler;
