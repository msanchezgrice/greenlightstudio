# Production Signup Flow Review

Date: 2026-03-06
Site: https://startupmachine.ai
Initial live commit under test: `bd66040`
Playwright runner: [tests/e2e/live-signup-runner.ts](/Users/miguel/Greenlight%20Studio/tests/e2e/live-signup-runner.ts)
Artifacts:
- [2026-03-06T17-43-42-482Z-live-signup-summary.json](/Users/miguel/Greenlight%20Studio/test-results/2026-03-06T17-43-42-482Z-live-signup-summary.json)
- [2026-03-06T17-43-42-482Z-live-signup-chromium.png](/Users/miguel/Greenlight%20Studio/test-results/2026-03-06T17-43-42-482Z-live-signup-chromium.png)
- [2026-03-06T17-43-42-482Z-live-signup-firefox.png](/Users/miguel/Greenlight%20Studio/test-results/2026-03-06T17-43-42-482Z-live-signup-firefox.png)
- [2026-03-06T17-43-42-482Z-live-signup-webkit.png](/Users/miguel/Greenlight%20Studio/test-results/2026-03-06T17-43-42-482Z-live-signup-webkit.png)

## What was verified

- Production home now routes the primary CTA into the public preview flow instead of forcing auth first.
- The public onboarding preview is live and reachable on all three tested Playwright engines: Chromium, Firefox, and WebKit.
- The production `/sign-up` route renders the Clerk card correctly with Google plus email/password options.
- The signup flow does not complete in unattended Playwright because Cloudflare Turnstile appears after submit and blocks continuation before email verification.

## Browser results

| Browser | Result | Final URL | Notes |
| --- | --- | --- | --- |
| Chromium | Blocked by Turnstile | `/sign-up` | Turnstile frame injected after submit |
| Firefox | Blocked by Turnstile | `/sign-up` | Same blocker |
| WebKit | Blocked by Turnstile | `/sign-up` | Same blocker |

## Ranked follow-ups

### 1. Strong Buy: tune or defer the Turnstile challenge on signup

- Cost: Medium
- Upside: Very high
- Why: this is the only hard blocker observed in the live signup flow. A visible human-check after submit adds friction for real users and completely blocks unattended production E2E.
- Options:
  - Move the challenge later in the abuse pipeline.
  - Use less aggressive bot protection for first-party signup.
  - Create a dedicated test bypass or test tenant for E2E.

### 2. Buy: instrument the auth funnel around Clerk

- Cost: Low to medium
- Upside: High
- Why: current analytics cover the preview flow, but not the exact auth drop-off. Add events for auth page view, submit clicked, Turnstile surfaced, verification started, verification completed, and redirect success.

### 3. Buy: keep signup in the “save your brief” context

- Cost: Low to medium
- Upside: Medium to high
- Why: the current Clerk page is generic. Users lose the founder-preview context right when they are asked to create an account.
- Recommendation: add wrapper copy around the auth card such as “Create your account to save this founder brief and launch Phase 0.”

### 4. Buy: route first-time users to account creation, not sign-in

- Cost: Low
- Upside: Medium
- Why: the preview handoff previously told signed-out users to “Sign in to save & launch,” which is the wrong CTA for a new user.
- Status: fixed locally after this review by switching the primary CTA to sign-up and leaving sign-in as the secondary option.

### 5. Buy: remove deprecated Clerk redirect props

- Cost: Low
- Upside: Medium
- Why: production logged the Clerk deprecation warning on page load. It is low severity, but it adds noise and creates future upgrade risk.
- Status: fixed locally after this review by replacing deprecated redirect props with `fallbackRedirectUrl`.

### 6. Hold: evaluate a custom auth wrapper if Turnstile stays

- Cost: Medium
- Upside: Medium
- Why: if the captcha remains necessary, the page should do more conversion work before asking users to complete it. Trust copy, no-credit-card language, and a short reminder of what gets saved would likely help.

## Bottom line

The production deployment is live and the preview-first front door is working. The remaining hard problem in the live signup path is not routing or rendering; it is the Turnstile gate that appears after submit and stops both automated verification and likely some share of legitimate first-time users.
