/**
 * Netlify Function: get-version
 *
 * GET /api/get-version
 * (also routed via redirect from /updates/version.json)
 *
 * Serves the live version.json feed.
 * Sources in priority:
 * 1. GitHub Raw / API (always fresh and persistent across serverless instances)
 * 2. Netlify Blobs 'updates' store
 * 3. Local bundled public/updates/version.json
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
  const repo = process.env.GITHUB_REPO || 'mpsingh2267/ULTIMATE-REPERTORY';

  // 1. Fetch live version.json from GitHub raw content (always fresh and persistent)
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/public/updates/version.json?_t=${Date.now()}`;
    const rawRes = await fetch(rawUrl, {
      headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Ultimate-Repertory-Portal' },
    });
    if (rawRes.ok) {
      versionObj = await rawRes.json();
    }
  } catch {
    // Continue to next source
  }

  // 2. Check Netlify Blobs 'updates' store if available
  if (!versionObj) {
    try {
      const store = await getBlobsStore('updates');
      if (store) {
        const blobVersion = await store.get('version.json');
        if (blobVersion) {
          versionObj = JSON.parse(blobVersion);
        }
      }
    } catch {}
  }

  // 3. Fall back to reading local public/updates/version.json bundled in lambda
  if (!versionObj) {
    try {
      const filePath = path.resolve(process.cwd(), 'public/updates/version.json');
      const fileContent = await fs.readFile(filePath, 'utf8');
      versionObj = JSON.parse(fileContent);
    } catch {}
  }

  // 4. Fall back to latest GitHub Release if all else fails
  if (!versionObj) {
    try {
      const relRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Ultimate-Repertory-Portal' },
      });
      if (relRes.ok) {
        const releases = await relRes.json();
        if (Array.isArray(releases) && releases.length > 0) {
          const latest = releases[0];
          const ver = latest.tag_name.replace(/^v/, '');
          let mac = '';
          let win = '';
          let apk = '';
          (latest.assets || []).forEach((a) => {
            const n = a.name.toLowerCase();
            if (n.endsWith('.pkg') || n.endsWith('.dmg')) mac = a.browser_download_url;
            else if (n.endsWith('.exe') || (n.includes('win') && n.endsWith('.zip'))) win = a.browser_download_url;
            else if (n.endsWith('.apk')) apk = a.browser_download_url;
          });
          versionObj = {
            version: ver,
            buildNumber: 178,
            releaseDate: (latest.published_at || latest.created_at || '').slice(0, 10),
            changelog: (latest.body || '').split('\n').map((s) => s.trim()).filter(Boolean),
            downloads: { macos: mac, windows: win, android: apk },
          };
        }
      }
    } catch {}
  }

  // Absolute fallback if everything is unavailable
  if (!versionObj) {
    versionObj = {
      version: '2.16.18',
      buildNumber: 178,
      releaseDate: new Date().toISOString().slice(0, 10),
      changelog: ['Latest release update'],
      downloads: {
        macos: 'https://github.com/mpsingh2267/ULTIMATE-REPERTORY/releases/download/v2.16.18/Ultimate-Repertory-Trial-2.16.18-Apple-Silicon.pkg',
        windows: '',
        android: '',
      },
    };
  }

  // Ensure compatibility fields for Flutter customerTrialUpdateUrl:
  // Requires edition: 'trial', downloads['${platform}_trial'], and editions: { trial: ... }
  versionObj.edition = versionObj.edition || 'trial';
  const dl = versionObj.downloads || {};
  dl.macos_trial = dl.macos_trial || dl.macos || '';
  dl.windows_trial = dl.windows_trial || dl.windows || '';
  dl.android_trial = dl.android_trial || dl.android || '';
  versionObj.downloads = dl;

  if (!versionObj.editions || !versionObj.editions.trial) {
    versionObj.editions = {
      trial: {
        version: versionObj.version,
        buildNumber: versionObj.buildNumber,
        releaseDate: versionObj.releaseDate,
        changelog: versionObj.changelog,
        downloads: { ...dl },
      },
    };
  }

  // Dynamically merge active revocations
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
  } catch {}

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify(versionObj, null, 2),
  };
};

export default handler;
