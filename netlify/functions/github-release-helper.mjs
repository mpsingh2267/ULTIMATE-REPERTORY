/**
 * Netlify Function: github-release-helper
 *
 * GET /api/github-release-helper
 * Returns whether GITHUB_TOKEN is configured in server environment and the target repo.
 *
 * POST /api/github-release-helper
 * Body: { token?: string, repo?: string, version: string, changelog?: string[] }
 * Creates or fetches the GitHub Release for the given version tag,
 * returning the direct upload URL for binary assets.
 */

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const defaultRepo = process.env.GITHUB_REPO || 'mpsingh2267/ULTIMATE-REPERTORY';
  const serverToken = process.env.GITHUB_TOKEN || '';

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hasServerToken: Boolean(serverToken),
        repo: defaultRepo,
      }),
    };
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

  const token = (body.token || serverToken).trim();
  const repo = (body.repo || defaultRepo).trim();
  const version = String(body.version || '').trim().replace(/^v/, '');
  const changelog = Array.isArray(body.changelog)
    ? body.changelog.join('\n')
    : String(body.changelog || 'Latest release update');

  if (!token) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'GitHub Personal Access Token is required' }),
    };
  }

  if (!version) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'Version string is required (e.g. 2.5.3)' }),
    };
  }

  const tagName = `v${version}`;
  const ghHeaders = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'Ultimate-Repertory-Licensing-Portal',
  };

  try {
    // 1. Check if release already exists for this tag
    let release = null;
    const getRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tagName}`, {
      headers: ghHeaders,
    });

    if (getRes.status === 200) {
      release = await getRes.json();
    } else if (getRes.status === 404) {
      // 2. Create the release if it does not exist
      const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: 'POST',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_name: tagName,
          name: `Ultimate Repertory v${version}`,
          body: changelog,
          draft: false,
          prerelease: false,
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(`GitHub release creation failed (${createRes.status}): ${errJson.message || createRes.statusText}`);
      }
      release = await createRes.json();
    } else {
      const errJson = await getRes.json().catch(() => ({}));
      throw new Error(`GitHub API error (${getRes.status}): ${errJson.message || getRes.statusText}`);
    }

    // Clean upload_url (remove {?name,label} template)
    const cleanUploadUrl = (release.upload_url || '').split('{')[0];

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        releaseId: release.id,
        tagName: release.tag_name,
        name: release.name,
        htmlUrl: release.html_url,
        uploadUrl: cleanUploadUrl,
        existingAssets: (release.assets || []).map((a) => ({
          id: a.id,
          name: a.name,
          downloadUrl: a.browser_download_url,
          size: a.size,
        })),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

export default handler;
