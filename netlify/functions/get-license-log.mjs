/**
 * Netlify Function: get-license-log
 * 
 * GET /api/get-license-log
 * 
 * Returns the persistent license key log from Netlify Blobs.
 */

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
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    let logArray = [];
    let revocations = [];

    const store = await getBlobsStore('license-keys');
    if (store) {
      const logData = await store.get('key-log.json');
      const revokedData = await store.get('revocations.json');
      
      if (logData) {
        try {
          logArray = JSON.parse(logData);
        } catch {
          logArray = [];
        }
      }

      if (revokedData) {
        try {
          revocations = JSON.parse(revokedData);
        } catch {
          revocations = [];
        }
      }

      const revokedDeviceSet = new Set(revocations.map((r) => (r.deviceCode || '').toUpperCase()).filter(Boolean));
      const revokedLicenseSet = new Set(revocations.map((r) => r.licenseId).filter(Boolean));

      logArray = logArray.map((item) => {
        const isRevoked =
          (item.deviceCode && revokedDeviceSet.has(item.deviceCode.toUpperCase())) ||
          (item.licenseId && revokedLicenseSet.has(item.licenseId));
        return {
          ...item,
          status: isRevoked ? 'Revoked' : item.status || 'Active',
        };
      });
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ log: logArray, revocations }),
    };
  } catch (error) {
    console.error('Failed to retrieve log from Blobs:', error);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Failed to retrieve log', log: [] }),
    };
  }
};

export default handler;
