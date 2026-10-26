/**
 * Netlify Function: get-version
 *
 * GET /api/get-version
 * (also routed via redirect from /updates/version.json)
 *
 * Serves the live version.json feed from Netlify Blobs, falling back to
 * bundled public/updates/version.json if not yet published.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.resolve(__dirname, '../../public/updates/version.json');

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
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // 1. Check Netlify Blobs 'updates' store if available
  if (getStore) {
    try {
      const store = getStore('updates');
      const blobVersion = await store.get('version.json');
      if (blobVersion) {
        return {
          statusCode: 200,
          headers: cors,
          body: blobVersion,
        };
      }
    } catch {
      // Fallback if blob fetch fails
    }
  }

  // 2. Fall back to reading public/updates/version.json from repository
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    return {
      statusCode: 200,
      headers: cors,
      body: fileContent,
    };
  } catch {
    // 3. Fallback default object if file is missing
    const fallback = {
      version: '2.5.1',
      buildNumber: 51,
      releaseDate: '2026-08-29',
      changelog: [
        'Auto-update system linked to this portal',
        'Persistent highlight and bold modes in Materia Medica',
        'Patient case search and document attachments',
        'Trial / Full licence management with in-app upgrade dialog',
      ],
      downloads: {
        macos: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.1-10-Day-Trial-Universal-Mac.pkg',
        android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.1-10-Day-Trial-Android-Tablet-Universal.apk',
      },
      revokedDevices: [],
      revokedLicenses: [],
    };
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify(fallback, null, 2),
    };
  }
};
