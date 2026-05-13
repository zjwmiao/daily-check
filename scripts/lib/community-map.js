export const COMMUNITY_MAP = {
  openEuler: {
    portal_owner: 'openeuler',
    portal_repo: 'openEuler-portal',
    portal_default_branch: 'master',
    site_base: 'https://www.openeuler.org',
    site_hosts: ['www.openeuler.org', 'openeuler.org'],
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
      if (cfg.site_hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
        return name;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
