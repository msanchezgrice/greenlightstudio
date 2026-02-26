import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  outputFileTracingIncludes: {
    "/api/projects/[projectId]/launch": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter-bash.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/vendor/**/*",
    ],
    "/api/projects/[projectId]/launch/route": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter-bash.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/vendor/**/*",
    ],
    "/api/nightshift/run": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter-bash.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/vendor/**/*",
    ],
    "/api/nightshift/run/route": [
      "./node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/manifest.zst.json",
      "./node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/tree-sitter-bash.wasm",
      "./node_modules/@anthropic-ai/claude-agent-sdk/vendor/**/*",
    ],
  },
};

export default nextConfig;
