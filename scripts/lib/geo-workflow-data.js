// 共享 helper:从 geo-workflow(private GitHub 仓)拉评估侧数据
// 之前 fetch-geo-issues.js 内联了这些函数,sync-geo-issues.js 也要用 → 提到 lib 复用

import axios from 'axios';

export const GEO_REPO = process.env.GEO_WORKFLOW_REPO || 'opensourceways/geo-workflow';
const GH_API = 'https://api.github.com';

export function ghClient(token = process.env.GEO_GITHUB_TOKEN) {
  return axios.create({
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'geo-develop-workflow',
    },
    timeout: 30000,
  });
}

export async function retry(fn, { label = 'http', max = 3, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || i === max - 1) {
        console.error(`❌ ${label} 终止(尝试 ${i + 1}/${max}, status=${status || 'network'}): ${err.message}`);
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, i);
      console.error(`⚠ ${label} 重试(${i + 1}/${max} 失败 ${status || 'network'}, ${delay}ms 后再试)`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function fetchJsonFile(community, filename) {
  return retry(
    async () => {
      const res = await ghClient().get(
        `${GH_API}/repos/${GEO_REPO}/contents/assessments/${community}/${filename}`
      );
      const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
      return JSON.parse(content);
    },
    { label: `fetch ${community}/${filename}` }
  );
}

export async function fetchQuestionsJson(community) {
  const data = await fetchJsonFile(community, 'questions.json');
  return data.questions || data;
}

export async function fetchIssueMap(community) {
  const data = await fetchJsonFile(community, 'issue-map.json');
  return data.issues || data;
}

export async function fetchIssue(issueNumber) {
  return retry(
    async () => {
      const res = await ghClient().get(`${GH_API}/repos/${GEO_REPO}/issues/${issueNumber}`);
      return res.data;
    },
    { label: `fetch issue #${issueNumber}` }
  );
}

export function extractQuestionIdsFromBody(body) {
  if (!body) return [];
  const ids = new Set();
  for (const m of body.matchAll(/`(q_\d+)`/g)) ids.add(m[1]);
  for (const m of body.matchAll(/- `?(q_\d+)`?/g)) ids.add(m[1]);
  return [...ids];
}

// 上游 geo-workflow issue 标题约定:`[<community>] ...`
export function extractCommunityFromTitle(title) {
  if (!title) return null;
  const m = title.match(/^\[([^\]]+)\]/);
  return m ? m[1] : null;
}

// 给一个上游 geo-workflow issue(srcIssue 是 GitHub issue 对象),判断其关联的 question 是否有可处理的 official_urls
// 用来在 sync 时过滤"P1 内容空白"类(关联 question 全无 official_urls)上游 issue
//
// 返回:
//   { hasUrls: true, community, valid_question_count, question_ids }
//   { hasUrls: false, community, reason }
//   { hasUrls: null, reason }   ← 抓不到数据时,谨慎当作 "无法判定",上游不动
export async function issueHasOfficialUrls(srcIssue) {
  const community = extractCommunityFromTitle(srcIssue.title);
  if (!community) {
    return { hasUrls: false, community: null, reason: 'issue 标题没有 [community] 前缀,无法定位 community' };
  }

  let questions;
  let issueMap;
  try {
    [questions, issueMap] = await Promise.all([
      fetchQuestionsJson(community),
      fetchIssueMap(community),
    ]);
  } catch (err) {
    return { hasUrls: null, community, reason: `读 ${community}/questions.json 或 issue-map.json 失败: ${err.message}` };
  }

  const questionById = new Map(questions.map((q) => [q.id, q]));

  // 先从 issueMap 取 question_ids(权威);没命中再从 issue body 抽
  let questionIds = null;
  for (const [, entry] of Object.entries(issueMap)) {
    if (String(entry.issue_number) === String(srcIssue.number)) {
      questionIds = entry.question_ids || [];
      break;
    }
  }
  if (questionIds === null) {
    questionIds = extractQuestionIdsFromBody(srcIssue.body);
  }

  const validQs = questionIds
    .map((id) => questionById.get(id))
    .filter((q) => q && Array.isArray(q.official_urls) && q.official_urls.length > 0);

  if (validQs.length > 0) {
    return {
      hasUrls: true,
      community,
      question_ids: questionIds,
      valid_question_count: validQs.length,
    };
  }
  return {
    hasUrls: false,
    community,
    question_ids: questionIds,
    reason:
      questionIds.length === 0
        ? '关联 question 列表为空(issue 既不在 issue-map.json 也无 `q_xxx` body 引用)'
        : '关联的 question 都没有非空 official_urls(P1 内容空白类,本仓 4 维度分析不适用)',
  };
}
