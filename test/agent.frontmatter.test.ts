import { describe, expect, test } from "bun:test";
import { parseAgentFile } from "../src/agents/agent.frontmatter.ts";

describe("parseAgentFile", () => {
  test("reads quoted values, lists and body", () => {
    const { meta, body, warning } = parseAgentFile(
      '---\nname: coder\ndescription: "Does: things \\"quoted\\""\nmodel: sonnet\ntools: Read, Grep,Glob\ndisallowedTools: Agent\ncolor: green\n---\n\nPrompt here\n',
    );
    expect(warning).toBeUndefined();
    expect(meta).toEqual({
      name: "coder", description: 'Does: things "quoted"', model: "sonnet",
      tools: ["Read", "Grep", "Glob"], disallowedTools: ["Agent"], color: "green",
    });
    expect(body).toBe("Prompt here");
  });

  test("unclosed frontmatter yields a warning and no fields", () => {
    const r = parseAgentFile("---\nname: x\nno end here\n");
    expect(r.meta).toEqual({});
    expect(r.warning).toContain("not closed");
  });

  test("no frontmatter keeps the whole text as body; single quotes and CRLF work", () => {
    expect(parseAgentFile("just text").body).toBe("just text");
    expect(parseAgentFile("---\r\nname: 'a b'\r\n---\r\nbody").meta.name).toBe("a b");
  });
});
