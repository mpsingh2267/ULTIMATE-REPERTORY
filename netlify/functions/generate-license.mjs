/**
 * Netlify Function: generate-license
 *
 * POST /api/generate-license
 * Body:
 *   {
 *     "deviceCode": "AABBCC-DDEEFF-112233-445566",  // 4×6 hex groups from the app
 *     "edition": "trial" | "full",
 *     "trialDuration": "10d" | "6m" | "180d" | number (days) // for trial edition
 *   }
 *
 * Returns:
 *   { "key": "UR1.<payload>.<signature>", "edition": "full"|"trial", "deviceCode": "...", "expiresAt": "..." }
 *
 * The key format matches what Flutter's _verifyToken() expects:
 *   UR1.<base64url(JSON-payload)>.<base64url(Ed25519-sig-over-payload-string)>
 *
 * JSON payload fields:
 *   { licenseId, edition, deviceCode, issuedAt (ISO), expiresAt (ISO|null) }
 *
 * PRIVATE_KEY_HEX must be set as a Netlify environment variable.
 * PRIVATE_KEY_HEX: first 32 bytes = Ed25519 seed in hex (64 hex chars minimum).
 */

import crypto from 'crypto';

let getStore = null;
try {
  const blobs = await import('@netlify/blobs');
  getStore = blobs.getStore;
} catch {
  // Blobs not available in local test environment
}

const hex2bytes = (hex) =>
  Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

// Standard base64url encode (no padding)
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

async function signEd25519(msgBytes, seedBytes) {
  try {
    const ed = await import('@noble/ed25519');
    return await ed.signAsync(msgBytes, seedBytes);
  } catch {
    const seed = Buffer.from(seedBytes);
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const privKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    return new Uint8Array(crypto.sign(null, msgBytes, privKey));
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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Load private key seed (first 32 bytes)
  const privateKeyHex = process.env.PRIVATE_KEY_HEX ?? '';
  if (!privateKeyHex || privateKeyHex.length < 64) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const normalizedDeviceCode = String(body.deviceCode ?? '').trim().toUpperCase();
  const edition = String(body.edition ?? 'trial').toLowerCase();

  if (!/^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$/.test(normalizedDeviceCode)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid device code' }) };
  }
  if (edition !== 'trial' && edition !== 'full') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Edition must be trial or full' }) };
  }

  // Calculate duration and expiration
  const rawDuration = String(body.trialDuration ?? body.duration ?? body.expiryDays ?? '10d').toLowerCase().trim();
  let expiryDays = 10;
  let durationLabel = '10 Days';

  if (edition === 'trial') {
    if (rawDuration === '6m' || rawDuration === '6months' || rawDuration === '180' || rawDuration === '180d') {
      expiryDays = 180;
      durationLabel = '6 Months';
    } else {
      const parsed = parseInt(rawDuration, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
        expiryDays = parsed;
        durationLabel = `${expiryDays} Days`;
      }
    }
  }

  // Build payload
  const issuedAt = new Date().toISOString();
  let expiresAt = null;
  if (edition === 'trial') {
    const exp = new Date(issuedAt);
    exp.setUTCDate(exp.getUTCDate() + expiryDays);
    expiresAt = exp.toISOString();
  }

  const payload = {
    licenseId: crypto.randomUUID(),
    edition,
    deviceCode: normalizedDeviceCode,
    issuedAt,
    expiresAt,
  };

  // Encode payload as base64url string — this string is what gets signed
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));

  // Sign the payload string bytes — matches Flutter: utf8.encode(pieces[1])
  const seed = hex2bytes(privateKeyHex).slice(0, 32);
  const msgBytes = new TextEncoder().encode(payloadStr);
  const signature = await signEd25519(msgBytes, seed);
  const sigStr = b64url(signature);

  const key = `UR1.${payloadStr}.${sigStr}`;

  // Log to Netlify Blobs for persistent storage
  if (getStore) {
    try {
      const store = getStore('license-keys');
      const logEntry = {
        date: new Date().toISOString().slice(0, 19).replace('T', ' '),
        deviceCode: normalizedDeviceCode,
        edition,
        duration: edition === 'trial' ? durationLabel : 'Permanent',
        issuedAt,
        expiresAt: expiresAt || null,
        keyPreview: key.slice(0, 24) + '…',
        licenseId: payload.licenseId,
        status: 'Active',
      };
      
      const existingLog = await store.get('key-log.json');
      let logArray = [];
      if (existingLog) {
        try {
          logArray = JSON.parse(existingLog);
        } catch {
          logArray = [];
        }
      }
      
      logArray.unshift(logEntry);
      logArray = logArray.slice(0, 200); // Keep last 200 entries
      await store.set('key-log.json', JSON.stringify(logArray, null, 2));
    } catch (blobError) {
      console.error('Failed to log to Blobs:', blobError);
      // Continue even if logging fails
    }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      edition,
      duration: edition === 'trial' ? durationLabel : 'Permanent',
      deviceCode: normalizedDeviceCode,
      issuedAt,
      expiresAt,
    }),
  };
};
