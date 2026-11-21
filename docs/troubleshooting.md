# Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Login and register pages say "Authentication is not configured" | `NEXT_PUBLIC_SUPABASE_URL` or the publishable key is missing | Set both (see `environment-variables.md`) and rebuild, because public vars are inlined at build time |
| Email links point to `http://localhost:3000` | `NEXT_PUBLIC_SITE_URL` was not set **at build time** | Set it and rebuild |
| Visiting `/app` shows a login redirect even in development | No session and UI preview is off | Sign in, or (only without Supabase) set `UNIAGENT_UI_PREVIEW=true` |
| `UNIAGENT_UI_PREVIEW=true` has no effect | Supabase is configured, which disables preview mode by design | Expected (ADR-012) |
| `/app/...` returns HTTP 200 for a missing tenant | Cache Components streams the redirect or not-found after the static shell | Expected. Content is not rendered. See `testing.md`, "Notes on HTTP status codes" |
| Build error: "uncached data was accessed outside of `<Suspense>`" | Cookies, headers, `searchParams`, or `params` read in a statically prerendered segment | Wrap the reading component in `<Suspense>`, or mark the segment `export const instant = false` if it should block (as `/app` and `/platform` do) |
| Build error about `new Date()` / `Math.random()` during prerender | Synchronous I/O in a static component | Move it into a `'use cache'` function (see `src/lib/time.ts`) or behind `connection()` |
| `next start` fails with `EADDRINUSE` | A previous server (process name `next-server`) is still running | `pkill -f next-server` |
| Playwright: "Executable doesn't exist" | `@playwright/test` version doesn't match the installed browser | Keep `@playwright/test` and the `playwright-core` override at the installed version (1.63.0 here); never run `playwright install` in this environment |
| Arabic text renders in a fallback font | `next/font` could not download IBM Plex Sans Arabic at build time | Check network access to Google Fonts during the build |
| Duplicate `id="main"` elements in the DOM | Next.js keeps recently visited routes mounted but hidden (React `<Activity>`) | Expected. Target visible elements in tests (`getByRole('main')`) |
