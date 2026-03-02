# Greenlight Studio COGS Model (Provisioned Paid Company)

Date: 2026-03-01  
Scope: Monthly cost per fully provisioned paid company in managed mode, with dedicated runtime components (Render + Neon) and LLM costs.

## 1) Pricing Inputs Used

All prices below are from public vendor pricing pages as of 2026-03-01.

- Anthropic Sonnet pricing: `$3 / input MTok`, `$15 / output MTok`
- Anthropic web search tool: `$10 / 1,000 searches`
- Render background worker Starter: `$7 / month`
- Render services Starter (web/private/background class): `$7 / month`
- Neon Launch usage rates:
  - `$0.106 / CU-hour`
  - `$0.35 / GB-month` (database storage)
  - `$0.20 / GB-month` (history/WAL storage)
- Resend Pro: `$20 / month` includes `50,000 emails`; overage `$0.90 / 1,000`
- Gemini image generation references:
  - Gemini image generation line item: `$0.0195 / image` (model-dependent)
  - Imagen 4 reference: `$0.02/$0.04/$0.06` per image (Fast/Standard/Ultra)
- Stripe billing fee reference: `2.9% + $0.30` (domestic card transaction)

## 2) Current Product Cost Drivers (from implementation)

- Chat turn:
  - Always calls `generateProjectChatReply` (Sonnet).
  - May also call `detectChatExecutionIntent` for execution-like requests.
- Phase packets:
  - Phase 0 = competitor + market + CEO synthesis (plus fallback path when needed).
  - Phase 1 = 5 direct strategy calls + CEO synthesis.
  - Phase 2/3 = 1 direct call each.
- Phase 1 deliverables:
  - Landing generation + design verification loop (up to 3 variants).
  - Brand deck spec generation.
  - 2 generated images (logo + hero).
- Nightshift and `brain.refresh` are currently non-LLM.

## 3) LLM Cost Formula (per company per month)

Use this as the canonical estimate:

`LLM = (input_tokens/1e6 * 3) + (output_tokens/1e6 * 15) + (web_searches/1000 * 10) + (images * image_price)`

Where `image_price` is typically `$0.04` for planning unless you pin to a cheaper/more expensive image SKU.

### Working planning assumptions

- Low usage:
  - 80 chat turns
  - 1 Phase 0 + 1 Phase 1 generation pass
  - 1 landing variant pass
  - 2 generated images
  - 5 web searches
  - Estimated LLM: `~$3.00`
- Base usage:
  - 250 chat turns
  - 1 Phase 0 + 1 Phase 1 + 1 Phase 2 + 1 Phase 3
  - 2 landing variant passes
  - 2 generated images
  - 10 web searches
  - Estimated LLM: `~$7.50`
- Heavy usage:
  - 800 chat turns
  - Multiple phase reruns and additional regeneration
  - 6 generated images
  - 50 web searches
  - Estimated LLM: `~$24.00`

## 4) Dedicated Element Cost by Component

These are the dedicated provisioning elements you asked to break out.

### Render (dedicated runtime)

- Dedicated worker (Starter): `$7.00`
- Dedicated web/private runtime (Starter): `$7.00`
- Render subtotal per company (if both are provisioned): `$14.00`

### Neon (dedicated DB per company)

Compute examples on Launch plan (`$0.106 / CU-hour`):

- Low: `40 CUh` -> `$4.24`
- Base: `140 CUh` -> `$14.84`
- Heavy: `400 CUh` -> `$42.40`

Storage examples:

- Low/Base: `1 GB data + 1 GB history` -> `$0.35 + $0.20 = $0.55`
- Heavy: `5 GB data + 5 GB history` -> `$1.75 + $1.00 = $2.75`

Neon subtotal:

- Low: `$4.79`
- Base: `$15.39`
- Heavy: `$45.15`

### Resend (email)

Two practical costing modes:

- Pooled account allocation (recommended default):
  - Low: `~3k emails` -> `~$1.20` effective allocation
  - Base: `~8k emails` -> `~$3.20` effective allocation
  - Heavy: `~25k emails` -> `~$9.00` effective allocation
- Dedicated Resend account per company:
  - Floor: `$20.00` each company (Pro), plus overage

## 5) All-In COGS per Provisioned Company

Below includes: LLM + dedicated Render + dedicated Neon + email + shared control-plane allocation.

Assumed shared allocation for core platform (Supabase/Vercel/observability/support infra):

- Low: `$3`
- Base: `$4`
- Heavy: `$6`

### A) Managed + pooled Resend (recommended default)

- Low: `LLM 3.00 + Render 14.00 + Neon 4.79 + Resend 1.20 + Shared 3.00 = $25.99`
- Base: `LLM 7.50 + Render 14.00 + Neon 15.39 + Resend 3.20 + Shared 4.00 = $44.09`
- Heavy: `LLM 24.00 + Render 14.00 + Neon 45.15 + Resend 9.00 + Shared 6.00 = $98.15`

Reference range: `~$26` low, `~$44` base, `~$98` heavy per month per paid company.

### B) Managed + dedicated Resend account per company

Add the delta from pooled to dedicated Resend:

- Low: `+$18.80`
- Base: `+$16.80`
- Heavy: `+$11.00`

Resulting totals:

- Low: `~$44.79`
- Base: `~$60.89`
- Heavy: `~$109.15`

## 6) Pricing Implications (quick reference)

At price point `$199/mo` (before Stripe fees):

- Base COGS `$44` -> gross margin `~78%`
- Heavy COGS `$98` -> gross margin `~51%`

At price point `$299/mo`:

- Base COGS `$44` -> gross margin `~85%`
- Heavy COGS `$98` -> gross margin `~67%`

Stripe billing fee still applies on top of COGS per successful charge.

## 7) Notes and Caveats

- This model is for the intended fully provisioned Phase 2 state.
- Current `runtime.provision_project` implementation is a provisioning state machine scaffold; real vendor-side provisioning depth will determine exact infra spend.
- LLM COGS is highly sensitive to:
  - average chat context length
  - phase regeneration frequency
  - landing variant retry rate
  - web-search tool call volume
- If you later move more workflows to cheaper model tiers or cache aggressively, LLM COGS can drop materially.

## 8) Pricing Source Links

- Anthropic models/pricing:
  - https://platform.claude.com/docs/en/about-claude/models/overview
  - https://platform.claude.com/docs/en/about-claude/pricing
- Render pricing:
  - https://render.com/pricing
- Neon pricing:
  - https://neon.com/pricing
- Resend pricing:
  - https://resend.com/pricing
- Google Gemini/Imagen pricing:
  - https://ai.google.dev/gemini-api/docs/pricing
- Stripe pricing:
  - https://stripe.com/pricing
