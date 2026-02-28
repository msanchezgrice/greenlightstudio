import { defineConfig } from "tsup";
import path from "path";

export default defineConfig({
  entry: ["src/worker/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist/worker",
  clean: true,
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      "@": path.resolve("./src"),
    };
  },
});
