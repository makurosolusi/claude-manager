import { expect, test } from "bun:test";
import tailwind from "bun-plugin-tailwind";

test("dashboard bundles with Tailwind utilities, theme tokens, and production React", async () => {
  const result = await Bun.build({
    entrypoints: ["src/web/index.html"],
    plugins: [tailwind],
    define: { "process.env.NODE_ENV": JSON.stringify("production") }, // same as scripts/build.ts
  });
  expect(result.success).toBe(true);
  const css = (await Promise.all(result.outputs.filter((o) => o.path.endsWith(".css")).map((o) => o.text()))).join("");
  const js = (await Promise.all(result.outputs.filter((o) => o.path.endsWith(".js")).map((o) => o.text()))).join("");
  // Utilities used only in .tsx files prove the plugin scanned the UI sources.
  for (const cls of [".bg-background", ".text-muted-foreground", ".whitespace-pre-wrap", ".animate-spin"]) expect(css).toContain(cls);
  expect(css).toContain("prefers-color-scheme");
  expect(js).not.toContain('unique "key" prop'); // React dev-build warning text
}, 60_000);

test("UI source never renders raw HTML (prompt text must stay plain text)", async () => {
  for await (const f of new Bun.Glob("src/web/**/*.tsx").scan()) {
    expect({ f, raw: (await Bun.file(f).text()).includes("dangerouslySetInnerHTML=") }).toEqual({ f, raw: false });
  }
});
