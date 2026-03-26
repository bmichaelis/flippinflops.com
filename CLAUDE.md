# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**flippinflops.com** — A static blog about wearing flip flops in a high desert mountain climate. Built on Astro with Cloudflare Pages for edge delivery, Cloudflare D1 for newsletter email storage, and Resend for email delivery.

This is the reference implementation for a reusable blog template pattern intended to be replicated for future sites.

## Stack

- **Astro** — static site framework with content collections for Markdown blog posts
- **Tailwind CSS** — via `@astrojs/tailwind`
- **Cloudflare Pages** — edge hosting + CDN; auto-deploys from GitHub `main` branch
- **Cloudflare D1** — SQLite-at-the-edge for newsletter subscriber storage
- **Resend** — transactional email API for newsletter sends
- **`@astrojs/cloudflare`** — Astro adapter for Cloudflare Pages SSR (used only for the newsletter API endpoint; blog is otherwise fully static)

## Common Commands

```bash
npm run dev          # Local dev server (localhost:4321)
npm run build        # Production build → dist/
npm run preview      # Preview build locally via Wrangler

# Cloudflare / Wrangler
npx wrangler pages dev dist          # Test Pages Functions + D1 bindings locally
npx wrangler d1 execute flippinflops-db --local --file=./schema.sql  # Apply schema locally
npx wrangler d1 execute flippinflops-db --file=./schema.sql          # Apply schema to prod D1
```

## Project Structure

```
src/
  content/
    blog/           # Markdown blog posts (.md / .mdx) — add posts here
    config.ts       # Content collection schema (frontmatter validation)
  pages/
    index.astro     # Home / post list
    blog/[slug].astro  # Dynamic post pages (statically generated)
    api/
      subscribe.ts  # Cloudflare Pages Function: POST email → D1
  layouts/
    Base.astro      # HTML shell, nav, footer
    Post.astro      # Blog post layout
  components/
    NewsletterForm.astro  # Email capture form (posts to /api/subscribe)
public/             # Static assets (images, fonts, favicon)
schema.sql          # D1 table definitions
wrangler.toml       # Cloudflare bindings (D1 database ID, etc.)
```

## Architecture Notes

### Static vs. SSR
The site is **mostly static** — all blog pages are pre-rendered at build time from Markdown files in `src/content/blog/`. The `@astrojs/cloudflare` adapter is enabled only to allow `src/pages/api/subscribe.ts` to run as a Cloudflare Pages Function (server-side). Set `output: 'static'` in `astro.config.mjs` (Astro 5 default). All pages are prerendered unless they export `export const prerender = false`.

### Blog Posts
Add a new `.md` file to `src/content/blog/`. Required frontmatter (enforced by the content collection schema):
```yaml
---
title: "Post Title"
pubDate: 2026-03-25
description: "Short description for SEO and post cards"
tags: ["flip-flops", "hiking"]
draft: false
---
```
Draft posts (`draft: true`) are excluded from production builds.

### Newsletter Flow
1. User submits email via `NewsletterForm.astro`
2. POST → `/api/subscribe` (Pages Function)
3. Function validates email, inserts into D1 `subscribers` table
4. On new post publish, trigger a Resend broadcast to all D1 subscribers (manual or via a separate Worker cron)

### D1 Schema
See `schema.sql`. The `subscribers` table stores `email`, `subscribed_at`, and `confirmed` (for double opt-in if added later).

### Wrangler Bindings
`wrangler.toml` must declare the D1 binding (`DB`) and the Resend API key via a secret (`RESEND_API_KEY`). Set the secret with:
```bash
npx wrangler secret put RESEND_API_KEY
```

### Deployment
Push to `main` → Cloudflare Pages auto-builds and deploys. Build command: `npm run build`. Output directory: `dist`.

## Reusable Template Notes

This repo is the blueprint for future blogs. When spinning up a new site:
1. Fork/copy this repo
2. Update `wrangler.toml` with a new D1 database ID
3. Update site metadata in `src/consts.ts` (site name, description, author)
4. Replace content in `src/content/blog/`
5. Wire up a new Cloudflare Pages project pointing to the new GitHub repo
