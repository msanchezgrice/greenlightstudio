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
  const jobId = url.searchParams.get("jobId");

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      let cursor = after ?? new Date(Date.now() - 60_000).toISOString();
      let lastEventId: string | null = null;
      const startedAt = Date.now();
      const MAX_STREAM_MS = 25_000;
      let lastPing = Date.now();

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

            if (lastEventId) {
              query = query.gt("id", lastEventId);
            } else {
              query = query.gt("created_at", cursor);
            }

            if (jobId) {
              query = query.eq("job_id", jobId);
            }

            const { data: events } = await query;

            if (events?.length) {
              for (const event of events) {
                send({
                  id: event.id,
                  jobId: event.job_id,
                  type: event.type,
                  message: event.message,
                  data: event.data,
                  createdAt: event.created_at,
                });
                lastEventId = event.id as string;
                cursor = event.created_at as string;
              }

              const lastEvent = events[events.length - 1];
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

          await new Promise((r) => setTimeout(r, 800));
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
