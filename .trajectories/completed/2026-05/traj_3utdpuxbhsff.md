# Trajectory: Add ProactiveReviewAdapter interface and GitHub implementation

> **Status:** ✅ Completed
> **Confidence:** 88%
> **Started:** May 31, 2026 at 02:02 PM
> **Completed:** May 31, 2026 at 02:14 PM

---

## Summary

Added ProactiveReviewAdapter core interface and GitHub implementation backed by existing GitHub writeback/proxy paths, with focused adapter tests and clean core/github/full turbo gates.

**Approach:** Standard approach

---

## Key Decisions

### Add core interface plus thin GitHub adapter wrapper
- **Chose:** Add core interface plus thin GitHub adapter wrapper
- **Reasoning:** Layer 3 needs provider-agnostic source-of-truth types; GitHub implementation delegates review submission to existing GitHubWritebackHandler and uses proxy requests for comments, PR creation, and update-branch.

---

## Chapters

### 1. Work
*Agent: default*

- Add core interface plus thin GitHub adapter wrapper: Add core interface plus thin GitHub adapter wrapper
