import { auth } from "@clerk/nextjs/server";
import { createServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { projectId } = await context.params;
  const db = createServiceSupabase();

  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_clerk_id", userId)
    .maybeSingle();

  if (!project) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const after = url.searchParams.get("after");
  const afterId = url.searchParams.get("afterId");
  const jobId = url.searchParams.get("jobId");
  const lastEventIdHeader = req.headers.get("last-event-id");

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (cancelled) return;
        try {
          const lines: string[] = [];
          if (typeof data.id === "string") {
            lines.push(`id: ${data.id}`);
          }
          lines.push(`data: ${JSON.stringify(data)}`, "");
          controller.enqueue(encoder.encode(lines.join("\n")));
        } catch {}
      };

      let cursorCreatedAt = after ?? new Date(Date.now() - 60_000).toISOString();
      let cursorId: string | null = afterId ?? lastEventIdHeader ?? null;
      const startedAt = Date.now();
      const MAX_STREAM_MS = 25_000;
      let lastPing = Date.now();
      const jobAgentCache = new Map<string, string>();

      const poll = async () => {
        while (!cancelled) {
          if (Date.now() - startedAt > MAX_STREAM_MS) {
            send({ type: "reconnect", message: "stream timeout" });
            controller.close();
            return;
          }

          if (Date.now() - lastPing > 5_000) {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {}
            lastPing = Date.now();
          }

          try {
            let query = db
              .from("agent_job_events")
              .select("id,job_id,type,message,data,created_at")
              .eq("project_id", projectId)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .limit(50);

            query = query.gte("created_at", cursorCreatedAt);

            if (jobId) {
              query = query.eq("job_id", jobId);
            }

            const { data: events } = await query;
            const filteredEvents = (events ?? []).filter((event) => {
              const eventCreatedAt = String(event.created_at ?? "");
              if (eventCreatedAt > cursorCreatedAt) return true;
              if (eventCreatedAt < cursorCreatedAt) return false;
              if (!cursorId) return true;
              return String(event.id) > cursorId;
            });

            if (filteredEvents.length) {
              const missingJobIds = Array.from(
                new Set(
                  filteredEvents
                    .map((event) => String(event.job_id ?? ""))
                    .filter((id) => id && !jobAgentCache.has(id)),
                ),
              );

              if (missingJobIds.length > 0) {
                const { data: jobRows } = await db
                  .from("agent_jobs")
                  .select("id,agent_key")
                  .in("id", missingJobIds);
                for (const row of jobRows ?? []) {
                  const jobIdValue = String(row.id ?? "");
                  const agentKeyValue = String(row.agent_key ?? "");
                  if (jobIdValue && agentKeyValue) {
                    jobAgentCache.set(jobIdValue, agentKeyValue);
                  }
                }
              }

              for (const event of filteredEvents) {
                const eventData = (event.data ?? {}) as Record<string, unknown>;
                const jobIdValue = String(event.job_id ?? "");
                const agentFromData =
                  typeof eventData.agent_key === "string"
                    ? eventData.agent_key
                    : typeof eventData.agent === "string"
                      ? eventData.agent
                      : null;
                send({
                  id: event.id,
                  jobId: event.job_id,
                  agent: agentFromData ?? (jobIdValue ? jobAgentCache.get(jobIdValue) ?? null : null),
                  type: event.type,
                  message: event.message,
                  data: event.data,
                  createdAt: event.created_at,
                });
                cursorId = event.id as string;
                cursorCreatedAt = event.created_at as string;
              }

              const lastEvent = filteredEvents[filteredEvents.length - 1];
              if (
                lastEvent?.type === "status" &&
                (lastEvent.message === "completed" ||
                  lastEvent.message === "failed")
              ) {
                send({ type: "done", message: lastEvent.message });
                controller.close();
                return;
              }
            }
          } catch (e) {
            if (!cancelled) {
              send({
                type: "error",
                message:
                  e instanceof Error ? e.message : "Stream error",
              });
            }
          }

          await new Promise((r) => setTimeout(r, 250));
        }
      };

      poll().catch(() => {
        if (!cancelled) {
          try {
            controller.close();
          } catch {}
        }
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
