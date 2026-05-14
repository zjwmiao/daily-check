import axios from 'axios';

const BASE = process.env.ATOMGIT_API_BASE || 'https://api.atomgit.com';
const API_PREFIX = '/api/v5';

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] atomgit-api ${msg}`);
}

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

// 通用重试:网络错误 + 5xx + 429,指数退避
async function retry(fn, { label = 'http', max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || i === max - 1) {
        log(`❌ ${label} failed (attempt ${i + 1}/${max}, status=${status || 'network'}): ${err.message}`);
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, i);
      log(`⚠ ${label} attempt ${i + 1}/${max} failed (${status || 'network'}), retry in ${delay}ms: ${err.message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function rejectOn4xx(res, label) {
  if (res.status >= 300) {
    const e = new Error(`${label} failed: ${res.status} ${JSON.stringify(res.data).slice(0, 500)}`);
    e.response = res;
    throw e;
  }
}

// AtomGit Issue 接口是 owner-scoped:repo 字段在 body 里
export async function createIssue({ owner, repo, title, body, labels }) {
  const payload = { repo, title, body };
  if (labels && labels.length) payload.labels = Array.isArray(labels) ? labels.join(',') : labels;
  return retry(
    async () => {
      const res = await client().post(`${API_PREFIX}/repos/${owner}/issues`, payload);
      rejectOn4xx(res, 'createIssue');
      return res.data;
    },
    { label: `createIssue(${owner}/${repo})` }
  );
}

// 更新 issue:PATCH /api/v5/repos/{owner}/{repo}/issues/{number}
// 注意:PATCH 走 repo-scoped 路径(与 owner-scoped 的 create 不同),body 字段用 `body`(实测;`description` 会被 400)
export async function updateIssue({ owner, repo, issue_number, title, body, labels }) {
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (labels !== undefined) payload.labels = Array.isArray(labels) ? labels.join(',') : labels;
  if (Object.keys(payload).length === 0) throw new Error('updateIssue: at least one of title/body/labels required');
  return retry(
    async () => {
      const res = await client().patch(`${API_PREFIX}/repos/${owner}/${repo}/issues/${issue_number}`, payload);
      rejectOn4xx(res, 'updateIssue');
      return res.data;
    },
    { label: `updateIssue(${owner}/${repo}#${issue_number})` }
  );
}

// 按 title 前缀查找已存在的 issue,用于去重
// AtomGit/Gitee 风格:GET /api/v5/repos/{owner}/{repo}/issues?state=all
export async function findIssueByTitlePrefix({ owner, repo, prefix, state = 'all' }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/issues`, {
        params: { state, per_page: 100 },
      });
      rejectOn4xx(res, 'listIssues');
      const list = Array.isArray(res.data) ? res.data : [];
      return list.find((i) => typeof i.title === 'string' && i.title.startsWith(prefix)) || null;
    },
    { label: `findIssueByTitlePrefix(${owner}/${repo})` }
  );
}

export async function addIssueComment({ owner, repo, issue_number, body }) {
  return retry(
    async () => {
      const res = await client().post(
        `${API_PREFIX}/repos/${owner}/${repo}/issues/${issue_number}/comments`,
        { body }
      );
      rejectOn4xx(res, 'addIssueComment');
      return res.data;
    },
    { label: `addIssueComment(${owner}/${repo}#${issue_number})` }
  );
}

export async function createPullRequest({ owner, repo, title, body, head, base }) {
  return retry(
    async () => {
      const res = await client().post(`${API_PREFIX}/repos/${owner}/${repo}/pulls`, {
        title,
        body,
        head,
        base,
      });
      rejectOn4xx(res, 'createPullRequest');
      return res.data;
    },
    { label: `createPullRequest(${owner}/${repo})` }
  );
}

export async function updatePullRequest({ owner, repo, number, title, body }) {
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (Object.keys(payload).length === 0) return null;
  return retry(
    async () => {
      const res = await client().patch(`${API_PREFIX}/repos/${owner}/${repo}/pulls/${number}`, payload);
      rejectOn4xx(res, 'updatePullRequest');
      return res.data;
    },
    { label: `updatePullRequest(${owner}/${repo}#${number})` }
  );
}

export async function getPullRequest({ owner, repo, number }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls/${number}`);
      rejectOn4xx(res, 'getPullRequest');
      return res.data;
    },
    { label: `getPullRequest(${owner}/${repo}#${number})` }
  );
}

export async function listPullRequests({ owner, repo, head, state = 'open' }) {
  const params = { state, per_page: 100 };
  if (head) params.head = head;
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls`, { params });
      rejectOn4xx(res, 'listPullRequests');
      return res.data;
    },
    { label: `listPullRequests(${owner}/${repo})` }
  );
}

export async function getRef({ owner, repo, ref }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/git/refs/${ref}`);
      if (res.status === 404) return null;
      rejectOn4xx(res, 'getRef');
      return res.data;
    },
    { label: `getRef(${owner}/${repo}@${ref})` }
  );
}
