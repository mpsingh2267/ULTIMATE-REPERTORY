/**
 * Netlify Function: generate-license
 *
 * POST /api/generate-license
 * Body:
 *   {
 *     "deviceCode": "AABBCC-DDEEFF-112233-445566",  // 4×6 hex groups from the app
 *     "edition": "trial" | "full",
 *     "expiryDays": 10          // only relevant for trial, default 10
 *   }
 *
 * Returns:
 *   { "key": "UR1.<payload>.<signature>", "edition": "full", "deviceCode": "..." }
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

import * as ed from '@noble/ed25519';
import { randomUUID } from 'crypto';

const hex2bytes = (hex) =>
  Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

// Standard base64url encode (no padding)
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

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

  // Build payload
  const issuedAt = new Date().toISOString();
  let expiresAt = null;
  if (edition === 'trial') {
    const exp = new Date(issuedAt);
    exp.setUTCDate(exp.getUTCDate() + 10);
    expiresAt = exp.toISOString();
  }

  const payload = {
    licenseId: randomUUID(),
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
  const signature = await ed.signAsync(msgBytes, seed);
  const sigStr = b64url(signature);

  const key = `UR1.${payloadStr}.${sigStr}`;

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, edition, deviceCode: normalizedDeviceCode, issuedAt, expiresAt }),
  };
};
