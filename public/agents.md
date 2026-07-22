# Agents Guide — startupmachine.ai

## What this product does

Startup Machine is an AI startup builder. A founder provides a one-line idea, a domain name, or a code repository, and a fleet of specialized AI agents (orchestrated by a CEO agent) researches competitors, sizes the market, drafts a pitch deck, and delivers a decision-ready founder brief with a go/no-go recommendation. Agents start in read-only mode; every phase transition requires explicit human approval.

## Key routes

Public (crawlable):

- `/` — Landing page: how it works, proof/sample briefs, phase pipeline, features, agent fleet.
- `/about` — About the product.
- `/resources` and `/resources/<slug>` — Founder guides with working templates and FAQs.
- `/contact` — Contact email for the team.
- `/privacy`, `/terms` — Legal policies.
- `/llms.txt`, `/agents.md`, `/.well-known/agent-card.json`, `/.well-known/ai-agent.json` — Agent discovery files.
- `/sitemap.xml`, `/robots.txt` — Crawl directives.

Authenticated (require sign-in via `/sign-in`; do not attempt to create accounts or sign in on behalf of a user):

- `/onboarding` — Project setup wizard (a no-account live preview is available at `/onboarding?new=1`).
- `/board`, `/dashboard`, `/projects/*`, `/inbox`, `/tasks`, `/batches`, `/chat`, `/settings` — Authenticated app surfaces. These are disallowed in robots.txt.

## How agents should interact

- Reading and citing public pages is allowed and encouraged.
- The primary call to action across the site is "Preview My Brief" (links to `/onboarding?new=1`), tagged with `data-agent-action` and `data-testid` attributes. It starts a free, no-account preview; it is safe to follow for demonstration purposes, but do not submit personal information.
- The landing page contains a waitlist email form (`data-agent-form="waitlist"`). Do not submit email addresses on behalf of real people without their explicit instruction.
- Actions marked with `data-agent-danger` (e.g., "Kill Project" in the authenticated app) are destructive and irreversible. Never trigger them without explicit human confirmation; they require the confirmation described in `data-agent-confirm`.
- There is no public API or MCP server at this time; interaction is via the web UI only.

## Contact

Questions or corrections: see `/contact` (email listed there).
