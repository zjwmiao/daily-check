import axios from 'axios';

const BASE = process.env.ATOMGIT_API_BASE || 'https://api.atomgit.com';

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

export async function createIssue({ owner, repo, title, body, labels }) {
  const res = await client().post(`/repos/${owner}/${repo}/issues`, {
    title,
    body,
    labels: labels || [],
  });
  if (res.status >= 300) {
    throw new Error(`createIssue failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function addIssueComment({ owner, repo, issue_number, body }) {
  const res = await client().post(
    `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    { body }
  );
  if (res.status >= 300) {
    throw new Error(`addIssueComment failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function createPullRequest({ owner, repo, title, body, head, base }) {
  const res = await client().post(`/repos/${owner}/${repo}/pulls`, {
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
  const res = await client().get(`/repos/${owner}/${repo}/pulls`, { params });
  if (res.status >= 300) {
    throw new Error(`listPullRequests failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function getRef({ owner, repo, ref }) {
  const res = await client().get(`/repos/${owner}/${repo}/git/refs/${ref}`);
  if (res.status === 404) return null;
  if (res.status >= 300) {
    throw new Error(`getRef failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}
