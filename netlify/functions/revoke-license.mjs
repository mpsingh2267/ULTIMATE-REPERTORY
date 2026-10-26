/**
 * Netlify Function: revoke-license
 *
 * POST /api/revoke-license
 * Body:
 *   {
 *     "passkey": "owner-admin-passkey",
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
 *     "passkey": "owner-admin-passkey",
 *     "deviceCode": "AABBCC-DDEEFF-112233-445566"
 *   }
 */

let getStore = null;
try {
  const blobs = await import('@netlify/blobs');
  getStore = blobs.getStore;
} catch {
  // Blobs not available in local test environment
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
      if (getStore) {
        const store = getStore('license-keys');
        const raw = await store.get('revocations.json');
        revocations = raw ? JSON.parse(raw) : [];
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
    let revocations = [];
    if (getStore) {
      const store = getStore('license-keys');
      const raw = await store.get('revocations.json');
      revocations = raw ? JSON.parse(raw) : [];

      if (event.httpMethod === 'DELETE') {
        // Remove revocation
        revocations = revocations.filter((r) => {
          if (normalizedDeviceCode && r.deviceCode === normalizedDeviceCode) return false;
          if (licenseId && r.licenseId === licenseId) return false;
          return true;
        });
        await store.set('revocations.json', JSON.stringify(revocations, null, 2));

        return {
          statusCode: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: 'Revocation removed' }),
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

        // Avoid duplicates
        revocations = revocations.filter(
          (r) =>
            (!normalizedDeviceCode || r.deviceCode !== normalizedDeviceCode) &&
            (!licenseId || r.licenseId !== licenseId)
        );
        revocations.unshift(revocationEntry);
        await store.set('revocations.json', JSON.stringify(revocations, null, 2));

        // Update key-log.json status if found
        try {
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
        } catch (logErr) {
          console.error('Failed to update status in log:', logErr);
        }

        // Sync into update feed (version.json in 'updates' store)
        try {
          const updateStore = getStore('updates');
          const rawVersion = await updateStore.get('version.json');
          let versionObj = rawVersion ? JSON.parse(rawVersion) : {};
          const revokedDevices = new Set(versionObj.revokedDevices || []);
          const revokedLicenses = new Set(versionObj.revokedLicenses || []);
          if (normalizedDeviceCode) revokedDevices.add(normalizedDeviceCode);
          if (licenseId) revokedLicenses.add(licenseId);

          versionObj.revokedDevices = Array.from(revokedDevices);
          versionObj.revokedLicenses = Array.from(revokedLicenses);
          await updateStore.set('version.json', JSON.stringify(versionObj, null, 2));
        } catch (updateErr) {
          console.error('Failed to sync revocation to version feed:', updateErr);
        }

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
    } else {
      // Local offline fallback
      const revokedAt = new Date().toISOString();
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: `Trial revoked immediately for device ${normalizedDeviceCode || licenseId} (offline mode)`,
          revokedAt,
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
