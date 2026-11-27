export const DEFAULT_RELEASE_REPO = "makurosolusi/claude-manager";

/** GitHub "owner/repo" that publishes releases; CLAUDE_MANAGER_REPO overrides. */
export const RELEASE_REPO = process.env.CLAUDE_MANAGER_REPO || DEFAULT_RELEASE_REPO;
/** GitHub REST API base; CLAUDE_MANAGER_RELEASE_API overrides (tests). */
export const GITHUB_API = process.env.CLAUDE_MANAGER_RELEASE_API || "https://api.github.com";
/** Base for release asset downloads; CLAUDE_MANAGER_RELEASE_DOWNLOAD overrides (tests). */
export const GITHUB_DOWNLOAD = process.env.CLAUDE_MANAGER_RELEASE_DOWNLOAD || "https://github.com";
/** Checksum file published next to the binaries by .github/workflows/release.yml. */
export const SUMS_ASSET = "SHA256SUMS";
