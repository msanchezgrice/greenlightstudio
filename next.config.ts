import type { NextConfig } from "next";

const claudeAgentTracing = [
  "./node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
  "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.json",
  "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json",
  "./node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm",
  "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter.wasm",
  "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter-bash.wasm",
  "./node_modules/@anthropic-ai/claude-agent-sdk/vendor/**/*",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  outputFileTracingIncludes: {
    "/api/projects/[projectId]/launch": claudeAgentTracing,
    "/api/projects/[projectId]/launch/route": claudeAgentTracing,
    "/api/projects/[projectId]/chat": claudeAgentTracing,
    "/api/projects/[projectId]/chat/route": claudeAgentTracing,
    "/api/inbox/[approvalId]/decision": claudeAgentTracing,
    "/api/inbox/[approvalId]/decision/route": claudeAgentTracing,
    "/api/nightshift/run": claudeAgentTracing,
    "/api/nightshift/run/route": claudeAgentTracing,
  },
};

export default nextConfig;
