import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const outputFile = "plugins/codsemble/scripts/codsemble.mjs";
await build({
  entryPoints: ["src/cli.ts"],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

const bundled = await readFile(outputFile, "utf8");
await writeFile(outputFile, bundled.replace(/[ \t]+$/gm, ""), "utf8");
