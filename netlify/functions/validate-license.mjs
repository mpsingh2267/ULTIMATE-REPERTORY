/**
 * Netlify Function: validate-license
 *
 * POST /api/validate-license
 * Body: { "deviceCode": "AABBCC-DDEEFF-...", "key": "UR1.<payload>.<sig>" }
 *
 * Returns:
 * { "valid": true,  "edition": "trial"|"full", "expiresAt": "ISO"|null, "daysRemaining": N }
 * { "valid": false, "error": "reason" }
 *
 * The key is:  UR1 . base64url(JSON-payload) . base64url(Ed25519-sig)
 * The signature is over:  utf8(payloadBase64urlString)  — exactly matching Flutter.
 *
 * Ed25519 public key must match the one embedded in the Flutter app:
 *   SOmyfK3o7JHhEF7vOPNvpAdyJxen7vfUY8BEv/YTUZo=
 */

import crypto from 'crypto';

// base64 (standard, with padding) → Uint8Array
const b64ToBytes = (s) => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const rem = padded.length % 4;
  const withPad = rem ? padded + '='.repeat(4 - rem) : padded;
  return Uint8Array.from(atob(withPad), (c) => c.charCodeAt(0));
};

// Ed25519 public key (same as embedded in Flutter app)
const PUBLIC_KEY_B64 = 'SOmyfK3o7JHhEF7vOPNvpAdyJxen7vfUY8BEv/YTUZo=';
const publicKey = b64ToBytes(PUBLIC_KEY_B64);

async function verifyEd25519(sigBytes, msgBytes, pubKeyBytes) {
  try {
    const ed = await import('@noble/ed25519');
    return await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
  } catch {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pubKeyBytes)]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return crypto.verify(null, msgBytes, pubKey, Buffer.from(sigBytes));
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
    return {
      statusCode: 405,
      headers: cors,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { deviceCode, key } = body;

  if (!deviceCode || !key) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Missing deviceCode or key' }),
    };
  }

  // Parse UR1.<payload>.<signature>
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'UR1') {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Invalid key format (expected UR1.payload.sig)' }),
    };
  }

  const [, payloadB64, sigB64] = parts;

  let payloadJson;
  let sigBytes;
  try {
    const payloadBytes = b64ToBytes(payloadB64);
    payloadJson = JSON.parse(new TextDecoder().decode(payloadBytes));
    sigBytes = b64ToBytes(sigB64);
  } catch {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Malformed key payload or signature' }),
    };
  }

  // Verify Ed25519 signature over the base64url payload string
  const msgBytes = new TextEncoder().encode(payloadB64);
  let valid = false;
  try {
    valid = await verifyEd25519(sigBytes, msgBytes, publicKey);
  } catch {
    valid = false;
  }

  if (!valid) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Invalid license signature' }),
    };
  }

  // Check device code match (case-insensitive)
  if ((payloadJson.deviceCode ?? '').toUpperCase() !== deviceCode.toUpperCase()) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Key belongs to a different device' }),
    };
  }

  // Check if device code or license ID has been revoked by admin
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('license-keys');
    const revokedData = await store.get('revocations.json');
    if (revokedData) {
      const revocations = JSON.parse(revokedData);
      const isRevoked = revocations.some(
        (r) =>
          (r.deviceCode && r.deviceCode.toUpperCase() === deviceCode.toUpperCase()) ||
          (r.licenseId && payloadJson.licenseId && r.licenseId === payloadJson.licenseId)
      );
      if (isRevoked) {
        return {
          statusCode: 200,
          headers: cors,
          body: JSON.stringify({
            valid: false,
            revoked: true,
            error: 'This licence has been revoked by the administrator with immediate effect.',
          }),
        };
      }
    }
  } catch {
    // Blobs may not be configured in offline dev mode
  }

  // Check expiry for trial
  const edition = payloadJson.edition ?? '';
  const expiresAt = payloadJson.expiresAt ? new Date(payloadJson.expiresAt) : null;
  const issuedAt = payloadJson.issuedAt ? new Date(payloadJson.issuedAt) : null;

  if (edition !== 'trial' && edition !== 'full') {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Unsupported license edition' }),
    };
  }

  if (edition === 'trial') {
    if (!issuedAt || Number.isNaN(issuedAt.getTime()) ||
        !expiresAt || Number.isNaN(expiresAt.getTime())) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, error: 'Trial dates are invalid' }),
      };
    }
    const durationMs = expiresAt.getTime() - issuedAt.getTime();
    // Allow up to 185 days (~6 months) plus buffer
    const maxAllowedDurationMs = 185 * 86400000 + 86400000;
    if (durationMs <= 0 || durationMs > maxAllowedDurationMs) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, error: 'Trial duration is invalid' }),
      };
    }
    if (new Date() >= expiresAt) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, error: 'Trial license has expired' }),
      };
    }
  } else if (expiresAt) {
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ valid: false, error: 'Full license must not expire' }),
    };
  }

  const daysRemaining =
    edition === 'full' || !expiresAt
      ? null
      : Math.max(0, Math.ceil((expiresAt - new Date()) / 86400000));

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valid: true,
      edition,
      expiresAt: expiresAt?.toISOString() ?? null,
      daysRemaining,
    }),
  };
};
