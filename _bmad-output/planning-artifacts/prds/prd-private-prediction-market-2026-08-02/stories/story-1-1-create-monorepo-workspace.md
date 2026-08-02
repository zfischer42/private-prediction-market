---
title: Create the monorepo workspace and app/package layout
status: draft
epic: 1
story: 1.1
---

# Story 1.1: Create the monorepo workspace and app/package layout

As a developer,
I want the project organized into web, api, shared, and Supabase-related packages,
So that the product can scale without mixing browser, server, and data concerns.

**Acceptance Criteria:**
- The repository has separate locations for the web app, API, shared packages, and Supabase assets.
- The workspace supports a repeatable local dev command for the main apps.
- The layout makes browser-only, server-only, and shared code boundaries obvious.
