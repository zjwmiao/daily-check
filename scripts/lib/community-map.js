export const COMMUNITY_MAP = {
  openEuler: {
    portal_owner: 'openeuler',
    portal_repo: 'openEuler-portal',
    portal_default_branch: 'master',
    site_base: 'https://www.openeuler.org',
    // 严格匹配 — forum.openeuler.org / discuss.* / news.* 等子站不在此列
    site_hosts: ['www.openeuler.org', 'openeuler.org', 'www.openeuler.openatom.cn', 'openeuler.openatom.cn'],
    sitemap_url: 'https://www.openeuler.org/sitemap.xml',
  },
  MindSpore: {
    portal_owner: 'mindspore',
    portal_repo: 'mindspore-portal',
    portal_default_branch: 'master',
    site_base: 'https://www.mindspore.cn',
    site_hosts: ['www.mindspore.cn', 'mindspore.cn'],
    sitemap_url: 'https://www.mindspore.cn/sitemap.xml',
  },
};

export const SUPPORTED_COMMUNITIES = Object.keys(COMMUNITY_MAP);

export function getCommunity(name) {
  return COMMUNITY_MAP[name] || null;
}

export function inferCommunityFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    for (const [name, cfg] of Object.entries(COMMUNITY_MAP)) {
      if (cfg.site_hosts.includes(host)) return name;
    }
  } catch {
    // ignore
  }
  return null;
}

// 严格判断 URL 是否属于该 community 的官网域(forum/discuss/news 等子站返回 false)
export function isOfficialHost(community, url) {
  const cfg = COMMUNITY_MAP[community];
  if (!cfg) return false;
  try {
    return cfg.site_hosts.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// 把 community 的所有等价 host(openeuler.org / openeuler.openatom.cn …)归一化到 site_hosts[0]。
// openEuler 双域名是同一份代码 + 构建环境变量切换,sitemap 仅产一份,匹配/收录判断必须先归一才不漏。
export function canonicalizeUrlHost(community, url) {
  const cfg = COMMUNITY_MAP[community];
  if (!cfg) return url;
  try {
    const u = new URL(url);
    if (cfg.site_hosts.includes(u.hostname) && u.hostname !== cfg.site_hosts[0]) {
      u.hostname = cfg.site_hosts[0];
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function inferCommunityFromRepoName(owner, repo) {
  const repoLower = repo.toLowerCase();
  for (const [name, cfg] of Object.entries(COMMUNITY_MAP)) {
    if (cfg.portal_repo.toLowerCase() === repoLower) return name;
    if (cfg.portal_owner.toLowerCase() === owner.toLowerCase() && repoLower.includes(name.toLowerCase())) return name;
  }
  return null;
}
