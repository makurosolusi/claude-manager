import { $ } from "bun";

const TARGETS = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
];

const arg = Bun.argv[2];
const targets = arg === "all" ? TARGETS : arg ? [arg] : [undefined];

for (const target of targets) {
  const suffix = target ? `-${target.replace(/^bun-/, "")}` : "";
  const outfile = `dist/claude-manager${suffix}${target?.includes("windows") ? ".exe" : ""}`;
  const targetFlag = target ? [`--target=${target}`] : [];
  // Without these flags the binary would load .env/bunfig.toml from the user's cwd (RND/03 §1).
  await $`bun build src/cli.ts --compile --minify --no-compile-autoload-dotenv --no-compile-autoload-bunfig ${targetFlag} --outfile ${outfile}`.quiet();
  console.log(`built ${outfile}`);
}
