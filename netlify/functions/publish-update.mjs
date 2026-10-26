/**
 * Netlify Function: publish-update
 *
 * POST /api/publish-update
 * Body:
 *   {
 *     "passkey": "owner-admin-passkey",
 *     "version": "2.5.2",
 *     "buildNumber": 52,
 *     "releaseDate": "2026-10-26",
 *     "changelog": ["Feature A", "Bug fix B"],
 *     "downloads": {
 *       "macos": "https://...",
 *       "windows": "https://...",
 *       "android": "https://..."
 *     }
 *   }
 *
 * Saves the update feed into Netlify Blobs ('updates' store, 'version.json'),
 * immediately serving it to apps checking the update feed.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localFilePath = path.resolve(__dirname, '../../public/updates/version.json');

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const version = String(body.version ?? '').trim();
  const buildNumber = parseInt(body.buildNumber, 10);
  const releaseDate = String(body.releaseDate ?? new Date().toISOString().slice(0, 10)).trim();
  let changelog = body.changelog;

  if (typeof changelog === 'string') {
    changelog = changelog.split('\n').map((s) => s.trim()).filter(Boolean);
  } else if (!Array.isArray(changelog)) {
    changelog = [];
  }

  if (!version) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Version string is required' }) };
  }
  if (isNaN(buildNumber) || buildNumber <= 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Build number must be a positive integer' }) };
  }

  const downloads = {
    macos: String(body.downloads?.macos ?? '').trim(),
    windows: String(body.downloads?.windows ?? '').trim(),
    android: String(body.downloads?.android ?? '').trim(),
  };

  try {
    let existingRevokedDevices = [];
    let existingRevokedLicenses = [];

    // Check store for existing revocations if store is available
    if (getStore) {
      try {
        const store = getStore('updates');
        const existingRaw = await store.get('version.json');
        if (existingRaw) {
          const existingParsed = JSON.parse(existingRaw);
          existingRevokedDevices = existingParsed.revokedDevices || [];
          existingRevokedLicenses = existingParsed.revokedLicenses || [];
        }
      } catch {
        // Ignore if no previous blob
      }
    }

    const versionFeed = {
      version,
      buildNumber,
      releaseDate,
      changelog,
      downloads,
      revokedDevices: existingRevokedDevices,
      revokedLicenses: existingRevokedLicenses,
      publishedAt: new Date().toISOString(),
    };

    // Store in Netlify Blobs if available
    if (getStore) {
      try {
        const store = getStore('updates');
        await store.set('version.json', JSON.stringify(versionFeed, null, 2));
      } catch (blobErr) {
        console.error('Failed to set in Blobs:', blobErr);
      }
    }

    // Also attempt local filesystem update for local dev or static deployment
    try {
      await fs.writeFile(localFilePath, JSON.stringify(versionFeed, null, 2), 'utf8');
    } catch {
      // In read-only serverless lambdas this may fail silently, which is completely expected
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `App update ${version} (Build ${buildNumber}) published successfully!`,
        update: versionFeed,
      }),
    };
  } catch (err) {
    console.error('Publish update error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Failed to publish update: ${err.message}` }),
    };
  }
};
