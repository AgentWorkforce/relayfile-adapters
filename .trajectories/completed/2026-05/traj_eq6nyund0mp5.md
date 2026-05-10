# Trajectory: Add Atlassian OAuth scopes to scope catalog

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 9, 2026 at 09:35 PM
> **Completed:** May 9, 2026 at 09:36 PM

---

## Summary

Added verified Atlassian OAuth scope catalog updates for Jira, Confluence, and Compass with source links from user app screenshots plus Atlassian/Nango docs. Kept the PR isolated in a fresh worktree so unrelated scope workflow edits from the main checkout are not included.

**Approach:** Standard approach

---

## Key Decisions

### Opened isolated worktree for Atlassian scope catalog PR
- **Chose:** Opened isolated worktree for Atlassian scope catalog PR
- **Reasoning:** The main checkout contains unrelated workflow-generated scope edits, so the PR should be based on origin/main and include only Jira, Confluence, and Compass scope catalog updates.

---

## Chapters

### 1. Work
*Agent: default*

- Opened isolated worktree for Atlassian scope catalog PR: Opened isolated worktree for Atlassian scope catalog PR
- Added verified Atlassian OAuth scope catalog entries for Jira, Confluence, and Compass using user-provided app registration screenshots plus Atlassian/Nango documentation. Relevant links: https://developer.atlassian.com/cloud/jira/software/scopes-for-oauth-2-3LO-and-forge-apps/ https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/ https://developer.atlassian.com/cloud/compass/graphql/ https://developer.atlassian.com/platform/forge/manifest-reference/scopes-product-compass/
