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

  let versionObj = null;

  // 1. Check Netlify Blobs 'updates' store if available
  try {
    const store = await getBlobsStore('updates');
    if (store) {
      const blobVersion = await store.get('version.json');
      if (blobVersion) {
        versionObj = JSON.parse(blobVersion);
      }
    }
  } catch {
    // Fallback if blob fetch fails
  }

  // 2. Fall back to reading public/updates/version.json from repository
  if (!versionObj) {
    try {
      const filePath = path.resolve(process.cwd(), 'public/updates/version.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      versionObj = JSON.parse(fileContent);
    } catch {
      // 3. Fallback default object if file is missing
      versionObj = {
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
    }
  }

  // 4. Always dynamically merge active revocations from 'license-keys' store
  try {
    const keyStore = await getBlobsStore('license-keys');
    if (keyStore) {
      const revData = await keyStore.get('revocations.json');
      if (revData) {
        const revocations = JSON.parse(revData);
        const devSet = new Set((versionObj.revokedDevices || []).map((d) => d.toUpperCase()));
        const licSet = new Set(versionObj.revokedLicenses || []);
        revocations.forEach((r) => {
          if (r.deviceCode) devSet.add(r.deviceCode.toUpperCase());
          if (r.licenseId) licSet.add(r.licenseId);
        });
        versionObj.revokedDevices = Array.from(devSet);
        versionObj.revokedLicenses = Array.from(licSet);
      }
    }
  } catch {
    // If revocations store read fails, continue with versionObj
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify(versionObj, null, 2),
  };
};

export default handler;
