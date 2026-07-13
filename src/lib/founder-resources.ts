import { wave2FounderResources } from "./wave2-founder-resources";

export type ResourceTable = {
  headers: string[];
  rows: string[][];
};

export type ResourceBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "table"; table: ResourceTable }
  | { type: "callout"; title: string; text: string }
  | { type: "template"; title: string; lines: string[] }
  | { type: "html"; html: string };

export type ResourceSection = {
  id: string;
  title: string;
  blocks: ResourceBlock[];
};

export type FounderResource = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  eyebrow: string;
  readingMinutes: number;
  primaryKeyword: string;
  updatedAt: string;
  sections: ResourceSection[];
  faqs: Array<{ question: string; answer: string }>;
};

const coreFounderResources: FounderResource[] = [
  {
    slug: "validate-startup-idea",
    title: "How to Validate a Startup Idea Before You Build",
    shortTitle: "Validate a startup idea",
    description:
      "A practical seven-day startup idea validation process with interview questions, evidence thresholds, and a go, pivot, or stop scorecard.",
    eyebrow: "Validation field guide",
    readingMinutes: 12,
    primaryKeyword: "startup idea validation",
    updatedAt: "2026-07-12",
    sections: [
      {
        id: "what-validation-means",
        title: "Validation means reducing a specific risk",
        blocks: [
          {
            type: "paragraph",
            text: "Startup idea validation is not collecting compliments. It is finding credible evidence that a defined customer has a costly problem, is motivated to solve it now, and will make a meaningful commitment to your approach. The goal is not certainty. The goal is to replace an expensive assumption with enough evidence to make the next investment rational.",
          },
          {
            type: "paragraph",
            text: "Begin by naming the assumption that could kill the business. An idea with obvious demand but impossible distribution needs a channel test. An idea in a familiar market with an unusual workflow needs a problem test. A product with strong usage and unclear economics needs a willingness-to-pay test. Test the riskiest assumption first, not the easiest one to discuss.",
          },
          {
            type: "template",
            title: "Write a falsifiable idea hypothesis",
            lines: [
              "Customer: [specific role or situation]",
              "Problem: struggles to [job] when [trigger]",
              "Current alternative: uses [workaround] and dislikes [cost or failure]",
              "Promise: our approach helps them [measurable outcome]",
              "Commitment: they will [pay, pre-order, introduce us, or schedule a pilot]",
              "Failure threshold: we will change direction if fewer than [number] of [number] qualified prospects commit",
            ],
          },
        ],
      },
      {
        id: "evidence-ladder",
        title: "Use an evidence ladder, not a survey score",
        blocks: [
          {
            type: "paragraph",
            text: "Different signals deserve different weights. A friend saying an idea sounds useful is weak evidence. A target buyer showing you their current spreadsheet is stronger. A signed pilot or payment is stronger still. Move up the ladder before you increase product scope.",
          },
          {
            type: "table",
            table: {
              headers: ["Signal", "What it proves", "Evidence strength"],
              rows: [
                ["Opinion or survey response", "The concept is understandable", "Low"],
                ["Recent problem story", "The problem happens in real life", "Medium"],
                ["Existing spend or workaround", "The problem already consumes money or time", "Medium-high"],
                ["Introduction or scheduled follow-up", "The buyer will spend social capital or time", "High"],
                ["Deposit, pre-order, or signed pilot", "The buyer will accept real risk", "Very high"],
              ],
            },
          },
          {
            type: "callout",
            title: "A useful rule",
            text: "Do not treat email addresses as demand unless the acquisition source and next commitment are clear. Ten qualified buyers agreeing to a specific next step can be more valuable than a thousand untargeted signups.",
          },
        ],
      },
      {
        id: "seven-day-sprint",
        title: "Run a seven-day startup validation sprint",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Day", "Action", "Deliverable"],
              rows: [
                ["1", "Define the customer, problem, current alternative, and failure threshold", "One-page hypothesis"],
                ["2", "Build a list of 30 people who match the segment", "Qualified outreach list"],
                ["3", "Conduct five problem interviews without pitching", "Quotes and repeated patterns"],
                ["4", "Conduct five more interviews and rank alternatives", "Problem frequency and cost"],
                ["5", "Show a lightweight offer, workflow, or concierge version", "Objections and preferred outcome"],
                ["6", "Ask for a concrete commitment", "Pilots, deposits, introductions, or scheduled trials"],
                ["7", "Score the evidence and choose go, pivot, or stop", "Written decision and next test"],
              ],
            },
          },
          {
            type: "paragraph",
            text: "Recruit from where the problem naturally appears: role-specific communities, professional groups, former colleagues, review sites, support forums, or people paying for an adjacent product. Avoid filling the sample with people who want to help you but would never buy.",
          },
        ],
      },
      {
        id: "interview-script",
        title: "Ask for behavior, not predictions",
        blocks: [
          {
            type: "paragraph",
            text: "A good interview reconstructs a recent event. It does not ask someone to imagine an ideal future. Stay with the last time the problem happened, what triggered it, how they handled it, what it cost, and why they chose that workaround.",
          },
          {
            type: "list",
            ordered: true,
            items: [
              "Tell me about the last time you tried to [job]. What triggered it?",
              "Walk me through what you did from the beginning.",
              "Where did the process slow down, fail, or require manual work?",
              "What have you tried already? What did it cost in time or money?",
              "Who else is involved in choosing or approving a solution?",
              "What happens if you do nothing for the next three months?",
              "If I could help with this outcome, what would a sensible next step look like?",
            ],
          },
          {
            type: "callout",
            title: "Avoid leading questions",
            text: "Replace “Would you use an AI tool that does this?” with “How do you handle this today?” The first invites politeness. The second reveals an existing workflow, budget, and urgency.",
          },
        ],
      },
      {
        id: "decision-scorecard",
        title: "Make the go, pivot, or stop decision explicit",
        blocks: [
          {
            type: "paragraph",
            text: "Score every dimension from zero to two: zero means no evidence, one means mixed evidence, and two means repeated evidence from qualified prospects. Record the source beside each score so enthusiasm cannot quietly become evidence.",
          },
          {
            type: "list",
            items: [
              "Problem frequency: the problem happened recently and repeatedly.",
              "Problem severity: delay or failure creates a measurable consequence.",
              "Current spend: buyers already spend money, labor, or political capital on it.",
              "Reachability: you can name a repeatable channel to find similar buyers.",
              "Commitment: prospects accept a concrete next step with real cost.",
              "Founder advantage: you have access, insight, credibility, or execution speed others lack.",
            ],
          },
          {
            type: "table",
            table: {
              headers: ["Score", "Decision", "Next move"],
              rows: [
                ["10–12", "Go", "Build only the smallest product needed to test repeated use"],
                ["6–9", "Pivot the test", "Change the segment, promise, channel, or commitment ask"],
                ["0–5", "Stop for now", "Archive the evidence and move to a stronger problem"],
              ],
            },
          },
        ],
      },
      {
        id: "next-step",
        title: "Turn validation into the next controlled bet",
        blocks: [
          {
            type: "paragraph",
            text: "If the idea passes, do not convert the whole vision into a backlog. Choose one narrow workflow and one behavior that would strengthen the evidence: a repeated task completed, a team invitation, a successful handoff, or a paid renewal. Your MVP should produce that learning with the least irreversible work.",
          },
          {
            type: "paragraph",
            text: "Write the decision, the supporting evidence, what remains unknown, and the date you will review it. That record protects you from retelling the validation story later and gives collaborators a clear reason for what you build next.",
          },
        ],
      },
    ],
    faqs: [
      {
        question: "How many interviews are enough to validate a startup idea?",
        answer:
          "Ten well-qualified interviews are often enough to expose repeated patterns, but interviews alone do not validate demand. Seek a stronger commitment such as a pilot, deposit, paid concierge test, introduction, or scheduled implementation step.",
      },
      {
        question: "Can I validate a startup idea without building a product?",
        answer:
          "Yes. Problem interviews, a manual concierge service, a clickable workflow, a landing-page offer, and a paid pilot can test the customer, urgency, promise, and willingness to pay before software exists.",
      },
      {
        question: "What is the biggest startup validation mistake?",
        answer:
          "The most common mistake is treating positive opinions as buying intent. Validation should measure recent behavior and a concrete commitment from a specific customer segment.",
      },
    ],
  },
  {
    slug: "startup-mvp-plan",
    title: "Startup MVP Plan: Scope a Testable Product in One Week",
    shortTitle: "Plan a testable MVP",
    description:
      "Use this startup MVP planning framework to choose one outcome, cut premature features, define success metrics, and launch a focused first test.",
    eyebrow: "MVP planning template",
    readingMinutes: 11,
    primaryKeyword: "startup MVP plan",
    updatedAt: "2026-07-12",
    sections: [
      {
        id: "mvp-purpose",
        title: "An MVP is an experiment with a product-shaped interface",
        blocks: [
          {
            type: "paragraph",
            text: "A minimum viable product is the smallest reliable experience that tests a business-critical assumption with real users. Minimum describes scope, not quality. Viable means a customer can complete the promised job safely enough to judge the outcome. Product means the experience can be repeated without the founder explaining every screen.",
          },
          {
            type: "paragraph",
            text: "The strongest MVP plans start with a decision. State what you need to learn, which behavior will answer it, and what result changes your next move. If the launch cannot produce a decision, it is a demo rather than an MVP.",
          },
          {
            type: "template",
            title: "MVP decision statement",
            lines: [
              "We need to learn whether [specific customer] will [valuable behavior]",
              "when [trigger] because [problem or desired outcome].",
              "We will consider the test promising if [number or percentage]",
              "of [qualified cohort] complete [behavior] within [time window]",
              "and at least [number or percentage] [return, pay, refer, or expand].",
            ],
          },
        ],
      },
      {
        id: "riskiest-assumption",
        title: "Choose the riskiest assumption before the feature list",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Risk", "Question", "Cheapest useful test"],
              rows: [
                ["Demand", "Will the target customer make this a priority?", "Paid concierge offer or pre-order"],
                ["Usability", "Can the customer complete the core workflow?", "Clickable prototype with task observation"],
                ["Feasibility", "Can the hard technical step work reliably?", "Narrow technical spike using real inputs"],
                ["Distribution", "Can we reach buyers at a workable cost?", "Small channel test with a qualified CTA"],
                ["Economics", "Can price exceed delivery and acquisition cost?", "Price test plus manual cost model"],
              ],
            },
          },
          {
            type: "paragraph",
            text: "Do not ask one MVP to resolve every risk. If feasibility is uncertain, build a technical spike before a polished flow. If demand is uncertain, sell a manual outcome before automating it. Sequence tests so the cheapest disconfirming result arrives first.",
          },
        ],
      },
      {
        id: "one-job",
        title: "Scope one user, one trigger, and one completed job",
        blocks: [
          {
            type: "paragraph",
            text: "A useful MVP has a narrow promise. Write a job story that identifies the situation, motivation, and expected outcome. Then define the shortest happy path from trigger to completed job. Every screen and integration must either enable that path, protect it, or measure it.",
          },
          {
            type: "template",
            title: "Job story and happy path",
            lines: [
              "When [situation or trigger],",
              "I want to [motivation or action],",
              "so I can [valuable outcome].",
              "Entry point: [how the user begins]",
              "Core action: [the one task they complete]",
              "Result: [what they receive or change]",
              "Proof: [how both user and team know it worked]",
            ],
          },
          {
            type: "callout",
            title: "The deletion test",
            text: "Remove a feature from the plan. If a qualified user can still reach the result and you can still measure the assumption, leave it out of the MVP.",
          },
        ],
      },
      {
        id: "scope-layers",
        title: "Separate launch scope from later convenience",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Layer", "Include when", "Typical examples"],
              rows: [
                ["Must work", "Without it, the core job fails or becomes unsafe", "Authentication if data is private, core workflow, result, error recovery"],
                ["Must measure", "Without it, the experiment cannot answer its question", "Activation event, cohort source, result event, payment or return event"],
                ["Manual behind the scenes", "The user outcome can be delivered reliably by a person", "Review, enrichment, onboarding, report assembly"],
                ["Later", "It adds convenience but does not change the decision", "Advanced settings, team roles, broad integrations, customization"],
              ],
            },
          },
          {
            type: "paragraph",
            text: "Manual operations are acceptable when they are invisible, dependable, and documented. They are not acceptable when users believe a result is automatic but delivery depends on an unmonitored founder inbox. Add a service-level promise, owner, and failure alert for every manual step.",
          },
        ],
      },
      {
        id: "mvp-brief",
        title: "Write the one-page MVP brief",
        blocks: [
          {
            type: "template",
            title: "Copy this MVP plan",
            lines: [
              "Customer and trigger: [who starts this, and when]",
              "Problem and current alternative: [what happens today]",
              "MVP promise: [one outcome, in plain language]",
              "Riskiest assumption: [demand, usability, feasibility, distribution, or economics]",
              "Happy path: [entry] → [core action] → [result]",
              "Launch cohort: [how many qualified users and where they come from]",
              "Primary metric: [one behavior tied to the assumption]",
              "Guardrails: [quality, safety, cost, or support limits]",
              "Pass threshold: [result that earns the next investment]",
              "Fail threshold: [result that triggers a pivot or stop]",
              "Excluded until after the test: [explicit non-goals]",
              "Decision date and owner: [when and who]",
            ],
          },
        ],
      },
      {
        id: "build-and-launch",
        title: "Use a four-week build-and-learn cadence",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Week 1 — prototype and observe: test the happy path with five qualified users before hardening it.",
              "Week 2 — build the path and instrumentation: implement only the must-work and must-measure layers.",
              "Week 3 — onboard a small cohort: watch every session you can, log failures, and repair blockers before adding features.",
              "Week 4 — repeat and decide: measure completion, return or payment, support burden, and the original pass threshold.",
            ],
          },
          {
            type: "paragraph",
            text: "Track a small event chain: qualified visitor, started core job, reached value, returned or paid. Include the cohort source and failure reason. A large analytics taxonomy cannot rescue an unclear success condition.",
          },
        ],
      },
      {
        id: "launch-gate",
        title: "Hold a launch gate before inviting the cohort",
        blocks: [
          {
            type: "list",
            items: [
              "A new user can complete the happy path without founder narration.",
              "The result is accurate enough for the promise and risk level.",
              "Failure states explain what happened and provide a recovery path.",
              "The primary activation and result events are visible in production.",
              "The team can identify and contact each test participant with consent.",
              "Manual steps have an owner, response window, and alert.",
              "Pass, pivot, and stop thresholds are written before results arrive.",
            ],
          },
          {
            type: "paragraph",
            text: "After the test, prioritize only what changes activation, delivery quality, repeat use, willingness to pay, or the cost of serving the validated workflow. Everything else waits until the evidence earns more scope.",
          },
        ],
      },
    ],
    faqs: [
      {
        question: "How long should it take to build a startup MVP?",
        answer:
          "A focused software MVP can often reach a small qualified cohort in two to six weeks. If the plan is longer, isolate the risky workflow and test more of the delivery manually before building the full scope.",
      },
      {
        question: "How many features should an MVP have?",
        answer:
          "There is no ideal feature count. Include only what enables one valuable end-to-end job, keeps that job safe and reliable, and measures the assumption the MVP exists to test.",
      },
      {
        question: "What metrics matter for an MVP?",
        answer:
          "Choose a primary behavior tied to the riskiest assumption, such as completing the core job, returning within a defined window, paying, or inviting a collaborator. Add quality and cost guardrails so growth does not hide a broken outcome.",
      },
    ],
  },
  {
    slug: "ai-startup-builder",
    title: "AI Startup Builder Guide: From Idea to a Go/No-Go Decision",
    shortTitle: "Choose an AI startup builder",
    description:
      "Learn what an AI startup builder should research, produce, and verify—and how to distinguish a decision workflow from a generic business-plan chatbot.",
    eyebrow: "Buyer’s guide",
    readingMinutes: 10,
    primaryKeyword: "AI startup builder",
    updatedAt: "2026-07-12",
    sections: [
      {
        id: "definition",
        title: "An AI startup builder should organize evidence, not just generate prose",
        blocks: [
          {
            type: "paragraph",
            text: "An AI startup builder is a workflow that turns an early idea or existing asset into evidence, explicit assumptions, and a controlled execution plan. The useful output is not a long business plan. It is a decision packet: who the customer is, what problem is worth testing, how the market behaves, which competitors matter, what the smallest test should include, and what evidence would justify continuing.",
          },
          {
            type: "paragraph",
            text: "General AI chat can help brainstorm these pieces, but the founder must maintain context, verify sources, reconcile contradictions, and turn answers into a sequence of decisions. A dedicated builder earns its place by making that process repeatable and auditable.",
          },
        ],
      },
      {
        id: "comparison",
        title: "Compare the operating model, not the number of generated documents",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Approach", "Best for", "Main limitation"],
              rows: [
                ["General AI chat", "Fast brainstorming and rewriting", "You own research quality, continuity, and decision logic"],
                ["AI startup builder", "Repeatable research, scoped recommendations, and execution gates", "Quality depends on inputs, sources, and visible assumptions"],
                ["Template library", "Founders who already know the answers", "A blank framework does not create evidence"],
                ["Consultant or agency", "High-stakes strategy with budget for deep human work", "Slower and more expensive for early exploration"],
              ],
            },
          },
          {
            type: "callout",
            title: "More output is not more certainty",
            text: "A 40-page deck built on an untested customer assumption is weaker than a two-page brief that separates facts, estimates, and unanswered questions.",
          },
        ],
      },
      {
        id: "inputs",
        title: "Start from the assets and constraints you already have",
        blocks: [
          {
            type: "paragraph",
            text: "The tool should accept more than a one-line prompt. A domain, current product, repository, customer notes, analytics snapshot, pricing, or budget can change the recommendation. Asset discovery prevents the system from proposing work that already exists and helps it distinguish a fresh idea from a product with real operating history.",
          },
          {
            type: "list",
            items: [
              "Idea input: the customer, problem, and desired outcome in plain language.",
              "Asset input: live domain, product flow, repository, brand, list, or prior research.",
              "Constraint input: time, budget, skills, regulatory exposure, and hard deadlines.",
              "Evidence input: interviews, conversion data, revenue, support themes, and acquisition sources.",
              "Decision input: what choice the founder must make next and by when.",
            ],
          },
        ],
      },
      {
        id: "outputs",
        title: "Require a decision-ready output",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "A precise customer and problem hypothesis, including the current alternative.",
              "Market sizing with assumptions visible, not a single unsupported market number.",
              "Competitor categories and substitutes, with dates and source links.",
              "A differentiated promise grounded in the target workflow.",
              "The riskiest assumptions ranked by cost and uncertainty.",
              "A validation or MVP plan with scope, metrics, thresholds, and non-goals.",
              "A clear go, pivot, hold, or stop recommendation with confidence and caveats.",
            ],
          },
          {
            type: "paragraph",
            text: "The recommendation should trace back to evidence. You should be able to see which claim came from a source, which number is an estimate, what the system inferred, and what remains unknown. If the output hides those boundaries, it encourages false precision.",
          },
        ],
      },
      {
        id: "evaluation",
        title: "Evaluate an AI startup builder with one real idea",
        blocks: [
          {
            type: "template",
            title: "Practical evaluation scorecard",
            lines: [
              "Context fidelity — Did it use my actual customer, asset, and constraints? [0–2]",
              "Source quality — Are market and competitor claims dated and traceable? [0–2]",
              "Assumption clarity — Are facts, estimates, and inferences separated? [0–2]",
              "Decision value — Does the recommendation change what I do next? [0–2]",
              "Scope discipline — Is the first test narrower than the full vision? [0–2]",
              "Control — Can I approve consequential actions before they happen? [0–2]",
              "Continuity — Can the project preserve decisions and evidence over time? [0–2]",
            ],
          },
          {
            type: "paragraph",
            text: "Run the same idea through your existing process and the candidate tool. Compare the claims, missing questions, proposed scope, and time required to reach a decision. Do not score writing style until you have scored evidence quality and actionability.",
          },
        ],
      },
      {
        id: "red-flags",
        title: "Watch for confident automation without operating guardrails",
        blocks: [
          {
            type: "list",
            items: [
              "Market numbers appear without a source, year, geography, or calculation.",
              "Competitor research ignores manual workarounds and doing nothing.",
              "Every idea receives a positive recommendation or the same feature list.",
              "The system can spend money, contact people, or deploy changes without an approval gate.",
              "Generated assets are not connected to a test, owner, metric, or decision date.",
              "The tool cannot distinguish observed facts from generated assumptions.",
              "Private source material is reused without clear data controls.",
            ],
          },
          {
            type: "paragraph",
            text: "AI can accelerate research and synthesis, but it does not remove founder responsibility. Verify claims that materially affect spend, legal exposure, market choice, or customer promises. Use human specialists for regulated and high-consequence decisions.",
          },
        ],
      },
      {
        id: "workflow",
        title: "Use the tool as a gated founder workflow",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Discover: provide the idea and inspect existing assets before generating new work.",
              "Decide: review the customer, market, risk, and go/no-go brief.",
              "Validate: approve a small evidence-gathering test with a fixed budget and threshold.",
              "Build: scope an MVP only after the relevant assumption earns it.",
              "Review: compare results with the original decision record and update the next bet.",
            ],
          },
          {
            type: "paragraph",
            text: "This structure turns AI from an answer machine into a decision system. The founder stays accountable for direction, while the system reduces the coordination cost of research, planning, and follow-through.",
          },
        ],
      },
    ],
    faqs: [
      {
        question: "What does an AI startup builder do?",
        answer:
          "A capable AI startup builder researches the customer, market, competitors, and existing assets; makes assumptions visible; recommends a go, pivot, or stop decision; and scopes the next validation or MVP test.",
      },
      {
        question: "Is an AI startup builder the same as a business-plan generator?",
        answer:
          "No. A business-plan generator primarily produces a document. An AI startup builder should maintain project context, use traceable research, expose uncertainty, define test thresholds, and connect recommendations to controlled execution.",
      },
      {
        question: "Can AI validate a startup idea for me?",
        answer:
          "AI can accelerate research, identify assumptions, prepare interview plans, and analyze evidence. Actual validation still requires credible behavior from real customers, such as repeated use, payment, a pilot, or another meaningful commitment.",
      },
    ],
  },
  {
    slug: "founder-execution-plan",
    title: "30-Day Founder Execution Plan and Weekly Template",
    shortTitle: "Run a 30-day founder plan",
    description:
      "A focused 30-day founder execution plan with weekly outcomes, a decision log, operating cadence, and metrics that prevent busywork.",
    eyebrow: "Founder operating system",
    readingMinutes: 11,
    primaryKeyword: "founder execution plan",
    updatedAt: "2026-07-12",
    sections: [
      {
        id: "one-decision",
        title: "Organize the month around one consequential decision",
        blocks: [
          {
            type: "paragraph",
            text: "Early-stage execution becomes noisy when every idea becomes a project. A useful founder execution plan begins with one decision the company must earn: whether to serve a segment, continue a product direction, invest in a channel, change pricing, or build the next workflow. The month should produce enough evidence to make that decision, not just a longer activity log.",
          },
          {
            type: "template",
            title: "Define the 30-day outcome",
            lines: [
              "Decision due: By [date], we will decide whether to [go, pivot, scale, or stop].",
              "Customer outcome: [specific customer] can [valuable result] when [trigger].",
              "Evidence required: [behavior, payment, retention, interviews, or delivery quality].",
              "Success threshold: [number or percentage] by [date].",
              "Guardrails: stay below [spend, time, quality, or risk limit].",
              "Non-goals: we will not [projects that do not affect this decision].",
            ],
          },
        ],
      },
      {
        id: "four-weeks",
        title: "Give each week one job",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Week", "Primary job", "Evidence produced"],
              rows: [
                ["1 — Focus", "Choose the customer, problem, baseline, and riskiest assumption", "Written hypothesis and qualified target list"],
                ["2 — Test", "Put the smallest credible offer or workflow in front of customers", "Observed behavior, objections, and commitments"],
                ["3 — Deliver", "Help a narrow cohort reach the promised outcome", "Activation, quality, support load, and repeat use"],
                ["4 — Decide", "Compare results with thresholds and document the next bet", "Go, pivot, hold, or stop decision"],
              ],
            },
          },
          {
            type: "paragraph",
            text: "Do not turn weekly jobs into departments. One person can research, sell, deliver, and analyze at this stage. The separation exists to protect sequence: choose the risk before launching work, observe before automating, and decide before expanding scope.",
          },
        ],
      },
      {
        id: "weekly-template",
        title: "Use a weekly plan that fits on one screen",
        blocks: [
          {
            type: "template",
            title: "Founder weekly execution template",
            lines: [
              "Weekly outcome: By Friday, [customer or company state will be different].",
              "Evidence target: [number] qualified [conversations, activations, payments, or returns].",
              "Three moves: 1) [highest leverage] 2) [second] 3) [third].",
              "Daily leading measure: [outreach, observed sessions, offers sent, or outcomes delivered].",
              "Blocker to remove first: [the constraint that stalls the entire week].",
              "Decision needed: [question], owner [name], due [day].",
              "Stop-doing list: [meetings, features, or channels paused this week].",
              "Friday review: expected [x], observed [y], learned [z], next [action].",
            ],
          },
          {
            type: "callout",
            title: "Write outcomes as changed states",
            text: "“Launch landing page” is an output. “Ten qualified visitors understand the promise and three request a pilot” is an outcome that can inform a decision.",
          },
        ],
      },
      {
        id: "daily-cadence",
        title: "Protect maker time with a light operating cadence",
        blocks: [
          {
            type: "list",
            items: [
              "Monday, 30 minutes: set the outcome, evidence target, three moves, and stop-doing list.",
              "Tuesday through Thursday, 10 minutes: check the leading measure and remove one blocker; do not re-plan the whole week.",
              "Daily, one protected block: complete the hardest customer-facing or product-learning task before internal cleanup.",
              "Friday, 45 minutes: review evidence against the prewritten threshold and record the decision or open question.",
            ],
          },
          {
            type: "paragraph",
            text: "Batch communication and administration after the protected block when possible. If an urgent task repeatedly displaces the evidence-producing work, treat that pattern as an operating constraint to solve rather than a personal productivity failure.",
          },
        ],
      },
      {
        id: "metrics",
        title: "Track one outcome metric, one leading measure, and two guardrails",
        blocks: [
          {
            type: "table",
            table: {
              headers: ["Metric type", "Purpose", "Example"],
              rows: [
                ["Outcome", "Shows whether the customer or business state changed", "Qualified users who complete the core job and return"],
                ["Leading", "Shows whether the team is creating enough chances to learn", "Observed onboarding sessions or offers sent"],
                ["Quality guardrail", "Prevents a headline number from hiding a broken result", "Successful result rate or support incidents"],
                ["Cost guardrail", "Keeps the test inside an acceptable bet", "Delivery hours per customer or acquisition spend"],
              ],
            },
          },
          {
            type: "paragraph",
            text: "Vanity metrics become dangerous when they substitute for the decision metric. Traffic can support a channel test but does not prove activation. Signups can support message clarity but do not prove repeat value. Always connect the number to the behavior it is meant to predict.",
          },
        ],
      },
      {
        id: "decision-log",
        title: "Keep a decision log so the company can learn",
        blocks: [
          {
            type: "template",
            title: "Decision log entry",
            lines: [
              "Date and decision: [what was decided]",
              "Context: [why this decision was needed now]",
              "Evidence: [links, numbers, and customer observations]",
              "Assumptions: [what remains inferred or uncertain]",
              "Options considered: [including doing nothing]",
              "Choice and rationale: [why this option]",
              "Expected result: [what should happen and by when]",
              "Revisit trigger: [date or evidence that reopens the decision]",
            ],
          },
          {
            type: "paragraph",
            text: "The log is not bureaucracy. It stops the team from reopening settled questions without new evidence and makes prediction errors visible. Over time, it also shows whether the company tends to overestimate demand, underestimate delivery cost, or hold weak experiments too long.",
          },
        ],
      },
      {
        id: "friday-decision",
        title: "End the month with a decision, not a retrospective alone",
        blocks: [
          {
            type: "list",
            items: [
              "Go: the evidence clears the threshold; name the next constraint and investment.",
              "Pivot: the problem is credible but the segment, promise, workflow, price, or channel needs a new test.",
              "Hold: an external dependency prevents a fair test; define the trigger and do not keep spending by default.",
              "Stop: evidence remains below the threshold; preserve the learning and release the capacity.",
            ],
          },
          {
            type: "paragraph",
            text: "A stop decision is productive when it arrives before a large irreversible investment. A go decision is only useful when it names the next evidence requirement. Either way, the operating system should make the following month narrower and more informed than the last.",
          },
        ],
      },
    ],
    faqs: [
      {
        question: "What should a founder focus on in the first 30 days?",
        answer:
          "Focus on one consequential decision and the evidence needed to make it. That usually means a specific customer, painful problem, narrow offer or workflow, qualified cohort, and a prewritten success threshold.",
      },
      {
        question: "How many goals should a startup have each week?",
        answer:
          "Use one weekly outcome supported by no more than three high-leverage moves. Other work can still happen, but it should not compete with the evidence-producing outcome.",
      },
      {
        question: "What belongs in a founder decision log?",
        answer:
          "Record the decision, context, evidence, remaining assumptions, options considered, rationale, expected result, and the date or trigger that would justify revisiting it.",
      },
    ],
  },
];

export const founderResources: FounderResource[] = [
  ...coreFounderResources,
  ...wave2FounderResources,
];

export function getFounderResource(slug: string) {
  return founderResources.find((resource) => resource.slug === slug);
}
