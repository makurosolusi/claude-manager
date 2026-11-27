import tailwind from "bun-plugin-tailwind";

const TARGETS = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
] as const;
type Target = (typeof TARGETS)[number];

/** Compiles the CLI (with the Tailwind-styled dashboard UI) into one executable. */
export async function buildBinary(outfile: string, target?: Target): Promise<void> {
  const result = await Bun.build({
    entrypoints: ["src/cli.ts"],
    // The JS API (not the CLI) is needed so bun-plugin-tailwind runs on the dashboard's HTML import.
    plugins: [tailwind],
    minify: true,
    // Bundles React's production build into the dashboard instead of the dev build.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    compile: {
      outfile,
      ...(target ? { target } : {}),
      // Without these the binary would load .env/bunfig.toml from the user's cwd (RND/03 §1).
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `build failed for ${outfile} (${target ?? "host"})`);
  }
}

if (import.meta.main) {
  const arg = Bun.argv[2];
  if (arg && arg !== "all" && !TARGETS.includes(arg as Target)) {
    throw new Error(`unknown target "${arg}"; expected one of: all, ${TARGETS.join(", ")}`);
  }
  const targets: (Target | undefined)[] = arg === "all" ? [...TARGETS] : [arg as Target | undefined];
  for (const target of targets) {
    const suffix = target ? `-${target.replace(/^bun-/, "")}` : "";
    const outfile = `dist/claude-manager${suffix}${target?.includes("windows") ? ".exe" : ""}`;
    await buildBinary(outfile, target);
    console.log(`built ${outfile}`);
  }
}
