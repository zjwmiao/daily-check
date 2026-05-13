import axios from 'axios';

const BASE = process.env.ATOMGIT_API_BASE || 'https://api.atomgit.com';
const API_PREFIX = '/api/v5';

function client() {
  const token = process.env.ATOMGIT_TOKEN;
  if (!token) throw new Error('ATOMGIT_TOKEN not set');
  return axios.create({
    baseURL: BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'geo-develop-workflow',
    },
    timeout: 30000,
    validateStatus: (s) => s < 500,
  });
}

// AtomGit/GitCode Issue API 是 owner-scoped:POST /api/v5/repos/{owner}/issues
// repo 通过 body 字段传入(与 GitHub 风格不同)
export async function createIssue({ owner, repo, title, body, labels }) {
  const payload = { repo, title, body };
  if (labels && labels.length) payload.labels = Array.isArray(labels) ? labels.join(',') : labels;
  const res = await client().post(`${API_PREFIX}/repos/${owner}/issues`, payload);
  if (res.status >= 300) {
    throw new Error(`createIssue failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function addIssueComment({ owner, repo, issue_number, body }) {
  const res = await client().post(
    `${API_PREFIX}/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    { body }
  );
  if (res.status >= 300) {
    throw new Error(`addIssueComment failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function createPullRequest({ owner, repo, title, body, head, base }) {
  const res = await client().post(`${API_PREFIX}/repos/${owner}/${repo}/pulls`, {
    title,
    body,
    head,
    base,
  });
  if (res.status >= 300) {
    throw new Error(`createPullRequest failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function listPullRequests({ owner, repo, head, state = 'open' }) {
  const params = { state };
  if (head) params.head = head;
  const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls`, { params });
  if (res.status >= 300) {
    throw new Error(`listPullRequests failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function getRef({ owner, repo, ref }) {
  const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/git/refs/${ref}`);
  if (res.status === 404) return null;
  if (res.status >= 300) {
    throw new Error(`getRef failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}
