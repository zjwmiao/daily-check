#!/usr/bin/env node

import { parseArgs, log } from '../lib/utils.js';
import { listIssues, listIssueComments } from '../lib/atomgit-api.js';
import fs from 'fs';
import yaml from 'yaml';
import path from 'path';

const CACHE_DIR = process.env.CACHE_DIR || '/tmp/.cache/geo-bot/issue-analyze';
const EXIST_ISSUES_DIR = path.join(CACHE_DIR, 'exist-issues');

const ANALYZE_RESULT_MARKER = '<!-- geo-analyze-result -->';
const ANALYZE_SKIP_MARKER = '<!-- geo-analyze-skip -->';
const ANALYZE_IGNORED_MARKER = '<!-- geo-analyze-ignored -->';

function loadProjectsConfig() {
  const configPath = path.join(process.cwd(), 'projects-config.yaml');
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.parse(content);
}

async function isIssueAlreadyProcessed(owner, repo, issueNumber) {
  try {
    const comments = await listIssueComments({ owner, repo, issue_number: issueNumber });
    return comments.some(c => 
      (c.body || '').includes(ANALYZE_RESULT_MARKER) ||
      (c.body || '').includes(ANALYZE_SKIP_MARKER) ||
      (c.body || '').includes(ANALYZE_IGNORED_MARKER)
    );
  } catch {
    return false;
  }
}

async function scanIssuesForProject(project) {
  const { name, owner, repo } = project;
  log(`▶ 扫描 ${owner}/${repo} [GEO] issues`);
  
  try {
    const issues = await listIssues({ owner, repo, state: 'open' });
    const geoIssues = issues.filter(i => i.title && i.title.startsWith('[GEO]'));
    log(`  找到 ${geoIssues.length} 个 [GEO] issue`);
    
    const filteredIssues = [];
    let skippedCount = 0;
    
    for (const issue of geoIssues) {
      // const alreadyProcessed = await isIssueAlreadyProcessed(owner, repo, issue.number);
      // if (alreadyProcessed) {
      //   skippedCount++;
      //   continue;
      // }
      filteredIssues.push(issue);
    }
    
    if (skippedCount > 0) {
      log(`  已处理: ${skippedCount} 个, 待处理: ${filteredIssues.length} 个`);
    }
    
    return {
      issues: filteredIssues.map(issue => ({
        owner,
        repo,
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        url: issue.html_url || issue.url || `https://atomgit.com/${owner}/${repo}/issues/${issue.number}`,
        html_url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at
      })),
      skipped: skippedCount
    };
  } catch (err) {
    log(`  ⚠ 扫描 ${owner}/${repo} 失败: ${err.message}`);
    return { issues: [], skipped: 0 };
  }
}

function saveIssueToCache(issue) {
  const { owner, repo, number } = issue;
  const filename = `${owner}-${repo}-${number}.md`;
  const filepath = path.join(EXIST_ISSUES_DIR, filename);
  
  const content = `---
owner: ${owner}
repo: ${repo}
issue_number: ${number}
title: ${issue.title}
url: ${issue.url}
created_at: ${issue.created_at}
updated_at: ${issue.updated_at}
---

# Issue #${issue.number}

**Title**: ${issue.title}

**URL**: ${issue.url}

## Issue Body

${issue.body}
`;
  
  fs.writeFileSync(filepath, content, 'utf-8');
  log(`  保存到: ${filepath}`);
  return filepath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  if (!process.env.ATOMGIT_TOKEN) {
    console.error('❌ ATOMGIT_TOKEN 未设置');
    process.exit(1);
  }
  
  fs.mkdirSync(EXIST_ISSUES_DIR, { recursive: true });
  
  const config = loadProjectsConfig();
  let projects = config.projects || [];
  
  // 只扫描 docs 类型项目
  projects = projects.filter(p => p.project_type === 'docs');
  
  if (projects.length === 0) {
    log('未找到 docs 类型项目');
    console.log(JSON.stringify({
      run_at: new Date().toISOString(),
      total_issues: 0,
      issues: [],
      summary: {
        projects_scanned: 0,
        issues_found: 0,
        issues_skipped: 0,
        docs_projects: 0,
        project_type_filter: 'docs'
      }
    }, null, 2));
    return;
  }
  
  if (args.project) {
    projects = projects.filter(p => p.name === args.project);
    if (projects.length === 0) {
      console.error(`❌ 未找到 docs 类型项目: ${args.project}`);
      process.exit(1);
    }
    log(`只处理项目: ${args.project}`);
  }
  
  log(`共 ${projects.length} 个 docs 项目待扫描`);
  
  const allIssues = [];
  let totalSkipped = 0;
  
  for (const project of projects) {
    const { issues, skipped } = await scanIssuesForProject(project);
    totalSkipped += skipped;
    
    for (const issue of issues) {
      const cacheFile = saveIssueToCache(issue);
      allIssues.push({
        ...issue,
        cache_file: cacheFile
      });
    }
  }
  
  const result = {
    run_at: new Date().toISOString(),
    total_issues: allIssues.length,
    issues: allIssues,
    summary: {
      projects_scanned: projects.length,
      issues_found: allIssues.length,
      issues_skipped: totalSkipped,
      docs_projects: projects.length,
      project_type_filter: 'docs'
    }
  };
  
  console.log(JSON.stringify(result, null, 2));
  
  const skipMsg = totalSkipped > 0 ? `, 跳过 ${totalSkipped} 个已处理` : '';
  log(`\n🏁 完成: 扫描 ${projects.length} 个 docs 项目, 找到 ${allIssues.length} 个待处理 issue${skipMsg}`);
}

main().catch(err => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});