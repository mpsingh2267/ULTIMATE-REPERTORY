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

import * as ed from '@noble/ed25519';

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
    valid = await ed.verifyAsync(sigBytes, msgBytes, publicKey);
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
    if (durationMs <= 0 || durationMs > 10 * 86400000 + 60000) {
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
