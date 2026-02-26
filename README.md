# Greenlight Studio — Complete Deliverables Package
## v2.3 · February 2026

### What is this?
Greenlight Studio is an AI-powered company builder that uses Claude Agent SDK to orchestrate 8 specialized agents. Users upload domain ideas → agents produce meeting-style greenlight packets → ideas progress through 5 phases with approval gates.

### Files in this package

#### Spec
- **spec-v2.3.html** — Full product spec with: MVG scope, 8 agents with Polsia best practices baked in, complete tooling map (Console Skills, Claude Code Plugins, SDK tools, custom MCPs, community MCPs), data model, phase pipeline, permission ladder, Night Shift flow, Polsia gap analysis, Codex 5.3 integration spec, template strategy.

#### Mockups (open in any browser)
- **mockup-greenlight-inbox.html** — Approval queue with risk-scored items (HIGH/MEDIUM/LOW), expandable CEO synopsis, approve/deny/revise actions.
- **mockup-phase0-packet.html** — Meeting-style Phase 0 packet with confidence score breakdown, existing presence check, competitor analysis, market sizing, MVP scope, CEO recommendation + reasoning synopsis.
- **mockup-onboarding-wizard.html** — Complete wizard flow with: ASCII state machine diagram, transition table with guards, data model (WizardState), 5 main screens (Import → Discover → Scan Results → Clarify → Confirm), 3 edge case screens (Scan Error, Parked Domain, Ideas Only), detailed screen specs with Polsia lessons on each step.

#### Plan Reviews (Garry Tan's plan-exit-review v2.0)
- **plan-review-v1.html** — First review against full 8-agent scope. Identified: plan is over-built (50 files, 12+ services). Recommended SCOPE REDUCTION to MVG. 10 issues found, 3 critical failure mode gaps.
- **plan-review-final.html** — Final review against MVG scope. Passes: 12 files, 3 services, 28 test cases, 18 golden eval fixtures. 4 issues found, all with recommended fixes. 1 acceptable gap (scheduler). READY TO BUILD.

### Architecture (MVG — Day 1)
```
Next.js Dashboard (Onboarding, Inbox, Viewer, Auth/Clerk)
        ↓ API routes
CEO Agent (Claude Agent SDK, TypeScript)
  ├── Research Subagent (WebSearch + WebFetch)
  └── Scanner Helper (WebFetch + classify inline)
        ↓ MCP
supabase-mcp (create_project, save_packet, update_phase, get_approval_queue, log_task)
        ↓
Supabase Postgres (+ RLS per project_id) + Cloudflare R2 (files)
```

### Tech Stack
- **Orchestration:** Claude Agent SDK (TypeScript)
- **LLM:** Claude Sonnet 4.6 (all agents)
- **Frontend:** Next.js 14 + Tailwind CSS
- **Database:** Supabase Postgres with Row Level Security
- **Auth:** Clerk
- **Storage:** Cloudflare R2
- **Task Queue:** SDK built-in (BullMQ deferred to Week 2-3)

### Timeline
- **Day 1-7:** MVG — CEO Agent + Research + supabase-mcp + Inbox + Onboarding + Packet Viewer
- **Week 2-3:** Design Agent, Brand Agent, Finance Agent, .pptx/.xlsx generation, Night Shift
- **Phase 1+:** Engineering Agent, Repo Analyst, Codex 5.3, email, landing page templates
- **Phase 2+:** Meta Ads, Cold Outreach, multi-model routing

### Key Decisions
1. **MVG first** — ship 2 agents + 1 MCP in 1 week, not 8 agents + 5 MCPs in 6 weeks
2. **Static HTML + R2** for landing pages, not shared Next.js runtime
3. **SDK built-in orchestration** — no BullMQ/Redis Day 1
4. **Zod schema enforcement** on Reasoning Synopsis (audit trail reliability)
5. **Golden test fixtures** for every LLM prompt (5 seed projects, 18 total evals)
6. **project_id on every MCP call** + Supabase RLS (belt + suspenders auth)

### Sources
- Original ChatGPT thread: Codex 5.3 API Design (full Greenlight Studio concept)
- Claude Agent SDK docs: platform.claude.com/docs/en/agent-sdk
- Claude Code Plugins: github.com/anthropics/claude-code/tree/main/plugins
- Polsia ConjureOS conversation: polsia.com/dashboard/conjureos
- Polsia /live dashboard: polsia.com/live
- Garry Tan's plan-exit-review: gist.github.com/garrytan/001f9074cab1a8f545ebecbc73a813df
