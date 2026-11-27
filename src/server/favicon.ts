/** Brand colours of the favicon square (light / dark scheme); mirrors `--brand` in index.css. */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>rect{fill:#0169cd}@media (prefers-color-scheme:dark){rect{fill:#3ba6f5}}</style><rect x="3" y="3" width="10" height="10" rx="2.5"/></svg>`;
const CACHE_SECONDS = 86400;

/** Paths that serve the favicon (.ico is the same SVG; browsers sniff it). */
export const FAVICON_PATHS = ["/favicon.svg", "/favicon.ico"];

/** The favicon response: inline SVG with a one-day cache. */
export const faviconResponse = () =>
  new Response(SVG, { headers: { "content-type": "image/svg+xml", "cache-control": `max-age=${CACHE_SECONDS}` } });
