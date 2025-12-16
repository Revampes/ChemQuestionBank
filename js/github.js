// Minimal GitHub functions used by student view (keeps repoInfo global used by student_app.js)
let repoInfo = null;

// A very small helper to keep student_app autoConnect working when using hardcoded REPO_CONFIG
async function fetchGitHub(endpoint, options = {}) {
    if (!repoInfo?.token) {
        throw new Error('GitHub not connected');
    }
    const defaultOptions = {
        headers: {
            'Authorization': `token ${repoInfo.token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    };
    const repoBase = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
    const cleanEndpoint = (endpoint || '').toString().replace(/^\/+/, '');
    const url = cleanEndpoint ? `${repoBase}/${cleanEndpoint}` : repoBase;
    const resp = await fetch(url, { ...defaultOptions, ...options });
    if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);
    return resp.json();
}

// Keep createOrUpdateFile stub to avoid missing reference if used
async function createOrUpdateFile(path, content, commitMessage, sha = null, options = {}) {
    throw new Error('createOrUpdateFile not implemented in standalone copy');
}
