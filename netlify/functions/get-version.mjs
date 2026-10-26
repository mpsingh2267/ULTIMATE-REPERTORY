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
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // 1. Check Netlify Blobs 'updates' store if available
  try {
    const store = await getBlobsStore('updates');
    if (store) {
      const blobVersion = await store.get('version.json');
      if (blobVersion) {
        return {
          statusCode: 200,
          headers: cors,
          body: blobVersion,
        };
      }
    }
  } catch {
    // Fallback if blob fetch fails
  }

  // 2. Fall back to reading public/updates/version.json from repository
  try {
    const filePath = path.resolve(process.cwd(), 'public/updates/version.json');
    const fileContent = await fs.readFile(filePath, 'utf8');
    return {
      statusCode: 200,
      headers: cors,
      body: fileContent,
    };
  } catch {
    // 3. Fallback default object if file is missing
    const fallback = {
      version: '2.5.2',
      buildNumber: 52,
      releaseDate: '2026-10-26',
      changelog: [
        '6-month trial support',
        'Immediate trial revocation capability',
        'Live update feed management via owner portal',
      ],
      downloads: {
        macos: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.2-Trial-Universal-Mac.pkg',
        windows: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.2-Trial-Windows-Setup.exe',
        android: 'https://ultimate-repertory.netlify.app/releases/Ultimate-Repertory-2.5.2-Trial-Android-Tablet-Universal.apk',
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

export default handler;
