import { auth, currentUser } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";
import { onboardingSchema } from "@/types/domain";
import { create_project, upsertUser } from "@/lib/supabase-mcp";
import { getOwnedProjects, getLatestPacketsByProject } from "@/lib/studio";
import { withRetry } from "@/lib/retry";
import { sendWelcomeDrip } from "@/lib/drip-emails";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const projects = await getOwnedProjects(userId);
    const projectIds = projects.map((p) => p.id);
    const latestPackets = await getLatestPacketsByProject(projectIds);

    const enriched = projects.map((p) => ({
      ...p,
      confidence: latestPackets.get(p.id)?.confidence ?? null,
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function normalizeDomain(raw: string) {
  return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function isValidDomain(raw: string) {
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(raw);
}

function projectSeedName(input: { domain: string | null; ideaDescription: string; repoUrl: string | null; scanTitle: string | null }) {
  if (input.domain) return input.domain;
  if (input.scanTitle) return input.scanTitle.slice(0, 80);
  if (input.repoUrl) {
    const parts = input.repoUrl.split("/").filter(Boolean);
    const repoName = parts.at(-1) ?? input.repoUrl;
    return repoName.slice(0, 80);
  }
  return input.ideaDescription.slice(0, 80);
}

function deriveIdeaDescription(input: {
  provided: string;
  domain: string | null;
  repoUrl: string | null;
  scanMetaDesc: string | null;
  scanMetaTitle: string | null;
}) {
  const provided = input.provided.trim();
  if (provided.length >= 20) return provided;

  const scanMetaDesc = input.scanMetaDesc?.trim() ?? "";
  if (scanMetaDesc.length >= 20) return scanMetaDesc;

  const scanMetaTitle = input.scanMetaTitle?.trim() ?? "";
  if (input.domain && scanMetaTitle) {
    return `Project seeded from ${input.domain}. Existing page title: ${scanMetaTitle}.`;
  }
  if (input.domain && input.repoUrl) {
    return `Project seeded from ${input.domain} with repository ${input.repoUrl}. Generate and validate a full launch recommendation.`;
  }
  if (input.domain) {
    return `Project seeded from domain ${input.domain}. Analyze existing signals and generate a full launch recommendation.`;
  }
  if (input.repoUrl) {
    return `Project seeded from repository ${input.repoUrl}. Analyze codebase context and generate a full launch recommendation.`;
  }

  throw new Error("Provide at least one domain, repository URL, or an idea description with 20+ characters.");
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = onboardingSchema.parse(await req.json());

  const clerkUser = await currentUser();
  const primaryEmail = clerkUser?.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)?.emailAddress ?? null;

  try {
    const userRowId = await withRetry(() => upsertUser(userId, primaryEmail));
    const rawDomains = Array.isArray(body.domains) ? body.domains : [];
    const normalizedDomains = Array.from(
      new Set(
        [body.domain ?? null, ...rawDomains]
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => normalizeDomain(entry))
          .filter(Boolean),
      ),
    );

    if (normalizedDomains.length > 10) {
      throw new Error("You can add up to 10 domains.");
    }

    const invalidDomains = normalizedDomains.filter((entry) => !isValidDomain(entry));
    if (invalidDomains.length) {
      throw new Error(`Invalid domain${invalidDomains.length > 1 ? "s" : ""}: ${invalidDomains.join(", ")}`);
    }

    const scanMetaDesc = body.scan_results?.meta?.desc ?? null;
    const scanMetaTitle = body.scan_results?.meta?.title ?? null;
    const repoUrl = body.repo_url?.trim() ? body.repo_url.trim() : null;

    const seedIdeaDescription = deriveIdeaDescription({
      provided: body.idea_description,
      domain: normalizedDomains[0] ?? null,
      repoUrl,
      scanMetaDesc,
      scanMetaTitle,
    });

    const targetDomains = normalizedDomains.length ? normalizedDomains : [null];
    const projectIds: string[] = [];

    for (const [index, domain] of targetDomains.entries()) {
      const ideaDescription =
        domain === normalizedDomains[0]
          ? seedIdeaDescription
          : deriveIdeaDescription({
              provided: body.idea_description,
              domain,
              repoUrl,
              scanMetaDesc,
              scanMetaTitle,
            });

      const projectId = await withRetry(() =>
        create_project({
          ownerClerkId: userId,
          userId: userRowId,
          name: projectSeedName({
            domain,
            ideaDescription,
            repoUrl,
            scanTitle: scanMetaTitle,
          }),
          domain,
          ideaDescription,
          repoUrl,
          runtimeMode: body.runtime_mode,
          permissions: body.permissions,
          nightShift: body.night_shift,
          focusAreas: body.focus_areas,
          scanResults: body.scan_results,
          wizardState: {
            step: "confirm",
            uploaded_files: body.uploaded_files ?? [],
            domains: normalizedDomains,
            batch_index: index,
            batch_size: targetDomains.length,
          },
        }),
      );
      projectIds.push(projectId);
    }

    const firstProjectName = projectSeedName({
      domain: targetDomains[0] ?? null,
      ideaDescription: seedIdeaDescription,
      repoUrl,
      scanTitle: scanMetaTitle,
    });

    after(async () => {
      try {
        const allProjects = await getOwnedProjects(userId);
        if (allProjects.length === projectIds.length && primaryEmail) {
          await sendWelcomeDrip(userRowId, primaryEmail, firstProjectName);
        }
      } catch {
        // Non-fatal: welcome email failure should not affect project creation
      }
    });

    return NextResponse.json({ projectId: projectIds[0], projectIds, createdCount: projectIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed creating project";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
