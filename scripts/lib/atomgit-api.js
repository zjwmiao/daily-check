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
// 业务异常(err.nonRetryable=true)直接抛,不再尝试
async function retry(fn, { label = 'http', max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err.nonRetryable) {
        log(`⏹ ${label} nonRetryable: ${err.message}`);
        throw err;
      }
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
export async function listIssues({ owner, repo, state = 'open' }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/issues`, {
        params: { state, per_page: 100 },
      });
      rejectOn4xx(res, 'listIssues');
      return Array.isArray(res.data) ? res.data : [];
    },
    { label: `listIssues(${owner}/${repo})` }
  );
}

export async function listIssueComments({ owner, repo, issue_number }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
        params: { per_page: 100 },
      });
      rejectOn4xx(res, 'listIssueComments');
      return Array.isArray(res.data) ? res.data : [];
    },
    { label: `listIssueComments(${owner}/${repo}#${issue_number})` }
  );
}

export async function findIssueByTitlePrefix({ owner, repo, prefix, state = 'all' }) {
  const list = await listIssues({ owner, repo, state });
  return list.find((i) => typeof i.title === 'string' && i.title.startsWith(prefix)) || null;
}

export async function findAllIssuesByTitlePrefix({ owner, repo, prefix, state = 'all' }) {
  const list = await listIssues({ owner, repo, state });
  return list.filter((i) => typeof i.title === 'string' && i.title.startsWith(prefix));
}

export async function closeIssue({ owner, repo, issue_number }) {
  return retry(
    async () => {
      const res = await client().patch(`${API_PREFIX}/repos/${owner}/${repo}/issues/${issue_number}`, {
        state: 'closed',
      });
      rejectOn4xx(res, 'closeIssue');
      return res.data;
    },
    { label: `closeIssue(${owner}/${repo}#${issue_number})` }
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

// AtomGit 错误信息里若已有同源分支的 open MR,会带 `!NNNN`(MR 编号)
// 解析出来给上层做 fallback-update
export class PullRequestAlreadyExistsError extends Error {
  constructor(existingNumber, raw) {
    super(`Another open PR already exists: #${existingNumber}`);
    this.name = 'PullRequestAlreadyExistsError';
    this.existingNumber = existingNumber;
    this.raw = raw;
    this.nonRetryable = true;
  }
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
      if (res.status >= 300) {
        // 业务错:同源分支已有 open MR — 抛专用类型,上层走 update 流程
        const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const m = raw.match(/already exists[^!]*!(\d+)/);
        if (m) throw new PullRequestAlreadyExistsError(Number(m[1]), raw);
        rejectOn4xx(res, 'createPullRequest');
      }
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

// PATCH state=closed 关闭 PR(不 merge,纯关)
export async function closePullRequest({ owner, repo, number }) {
  return retry(
    async () => {
      const res = await client().patch(`${API_PREFIX}/repos/${owner}/${repo}/pulls/${number}`, {
        state: 'closed',
      });
      rejectOn4xx(res, 'closePullRequest');
      return res.data;
    },
    { label: `closePullRequest(${owner}/${repo}#${number})` }
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

// AtomGit 的 `head` 过滤只认裸 branch 名,不认 GitHub 风格的 `owner:branch`。
// 为了兼容历史调用方,这里把 `owner:branch` 拆出 branch 部分;另外 API 过滤偶发失灵,
// 兜底再做一次客户端过滤(按 head.ref 全字符串匹配)。
export async function listPullRequests({ owner, repo, head, state = 'open' }) {
  const params = { state, per_page: 100 };
  const branch = head && head.includes(':') ? head.split(':').slice(1).join(':') : head;
  if (branch) params.head = branch;
  const list = await retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls`, { params });
      rejectOn4xx(res, 'listPullRequests');
      return Array.isArray(res.data) ? res.data : [];
    },
    { label: `listPullRequests(${owner}/${repo})` }
  );
  if (!branch) return list;
  // 服务器若按 head 过滤过就只剩匹配项;若没过滤过(API 静默忽略未知参数)就需要再筛
  const filtered = list.filter((pr) => (pr.head && pr.head.ref) === branch);
  return filtered;
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

export async function listPullRequestComments({ owner, repo, pull_number }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls/${pull_number}/comments`, {
        params: { per_page: 100 },
      });
      rejectOn4xx(res, 'listPullRequestComments');
      return Array.isArray(res.data) ? res.data : [];
    },
    { label: `listPullRequestComments(${owner}/${repo}#${pull_number})` }
  );
}

export async function getPullRequestComment({ owner, repo, comment_id }) {
  return retry(
    async () => {
      const res = await client().get(`${API_PREFIX}/repos/${owner}/${repo}/pulls/comments/${comment_id}`);
      rejectOn4xx(res, 'getPullRequestComment');
      return res.data;
    },
    { label: `getPullRequestComment(${owner}/${repo}#${comment_id})` }
  );
}
