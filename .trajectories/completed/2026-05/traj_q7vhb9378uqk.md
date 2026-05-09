# Trajectory: Wire Jira privacy-safe adapter storage

> **Status:** ✅ Completed
> **Confidence:** 90%
> **Started:** May 9, 2026 at 08:56 PM
> **Completed:** May 9, 2026 at 08:56 PM

---

## Summary

Added default-on Jira record sanitization, exported the sanitizer, removed user profile semantics/relations, and added regression coverage that stored Jira content omits email, display name, and accountId.

**Approach:** Standard approach

---

## Key Decisions

### Redact Atlassian user profile objects before Jira records reach storage
- **Chose:** Redact Atlassian user profile objects before Jira records reach storage
- **Reasoning:** Avoiding stored account IDs, display names, emails, avatars, and timezones keeps Relayfile out of Atlassian personal-data reporting for profile data while preserving issue/project/sprint/comment content.

---

## Chapters

### 1. Work
*Agent: default*

- Redact Atlassian user profile objects before Jira records reach storage: Redact Atlassian user profile objects before Jira records reach storage
