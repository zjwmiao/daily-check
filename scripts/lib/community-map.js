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
