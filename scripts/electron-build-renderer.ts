/**
 * Cross-platform renderer build script
 */

import { spawn } from "bun";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
process.env.VITE_CRAFT_PRODUCT_VARIANT = process.env.CRAFT_PRODUCT_VARIANT || 'runner';

// Vite stages and publishes the complete renderer; failed builds retain the current output.
const proc = spawn({
  cmd: ["bun", "run", "vite", "build", "--config", "apps/electron/vite.config.ts"],
  cwd: ROOT_DIR,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
});

const exitCode = await proc.exited;
process.exit(exitCode);
