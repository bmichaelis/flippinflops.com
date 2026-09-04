# Migrating this site from Cloudflare Pages to Workers

Written 2026-09-03, straight after doing the same migration on
`~/repos/kindacoach.com`, which was cloned from this repo. Everything here was
hit for real on that site, not read in a changelog.

Pick this up in a fresh session scoped to this repo.

---

## Read this part first

**This site is live and has 6 real newsletter subscribers.** kindacoach.com was
empty when it was migrated; this one is not. That changes the order of
operations, and it is the only genuinely risky part of the job.

Two things follow from it:

- **The D1 database is not touched by this migration.** Same database
  (`flippinflops-db`, id `a1b5457f-33ed-45a9-a580-b7a7241fadd8`), same `DB`
  binding, same rows. The subscribers are not at risk. Do not "migrate" or
  recreate the database.
- **The domain cutover is the risky step, and it comes last.** `flippinflops.com`
  is currently served by the `flippinflops-com` Pages project. Deploy the
  Worker, verify it on its `workers.dev` URL, and only then move the domain.

If you only get halfway, stop somewhere safe: a deployed-but-not-routed Worker
changes nothing for visitors.

## Why bother

Cloudflare and the Astro deploy guide both point new projects at Workers —
Astro's guide says so in as many words. Pages is not deprecated, and Cloudflare
still lists things Pages does better (Early Hints, custom domains on zones it
doesn't manage). Neither applies here.

The concrete wins for this repo:

- **Push-to-deploy actually works.** This repo's `CLAUDE.md` claims the site
  auto-deploys from GitHub `main`. It does not. `wrangler pages project list`
  reports `flippinflops-com` with **Git Provider: No** — it is a direct-upload
  project, so pushing to `main` does nothing. Workers Builds fixes this, and on
  kindacoach.com a push went live in about 40 seconds.
- A Pages direct-upload project can never be converted to Git-connected. A
  Worker can have Workers Builds attached after the fact. Workers is the less
  trapping choice.

## Current state of this repo

```
astro                     ^5.0.0
@astrojs/cloudflare       ^12.0.0
@cloudflare/workers-types ^4.0.0
wrangler                  ^4.77.0
src/content/config.ts     legacy content collections
wrangler.toml             pages_build_output_dir = "./dist"
origin                    gh-bmichaelis:bmichaelis/flippinflops.com.git
```

This site has since gained **double opt-in** (`bb6d393`), which kindacoach.com
does not have. That means more surface than the template it was cloned from:

- two API routes, `/api/subscribe` and `/api/confirm`, **both** reading
  `locals.runtime.env`
- a prerendered `/confirmed` page
- a `token` column, and a `migrations/` directory holding
  `0001_add_subscriber_token.sql`

Migrate and verify both routes. It is easy to fix `subscribe.ts`, see a 201, and
never notice that `confirm.ts` still throws.

Identical to kindacoach.com before its migration, so this should be close to a
replay.

## The version ladder

The platform change forces the framework upgrade. There is no way to do one
without the other:

| adapter | requires |
|---|---|
| 12.x | Astro 5 |
| 13.x | Astro 6 |
| 14.x | Astro 7 |

Adapter 14 **rejects a Pages-shaped `wrangler.toml` outright**
(`the name 'ASSETS' is reserved in Pages projects`), and the Workers config in
the current docs only exists on adapter 14. So Astro 5 + Workers is not a
stable resting place. Go to Astro 7 in the same change and say so in the commit
message — a split produces an intermediate commit that does not build.

---

## Steps

### 1. Upgrade the dependencies

```bash
npm install astro@^7.3.1 @astrojs/cloudflare@^14.3.0 \
            wrangler@^4.125.0 @cloudflare/workers-types@^5.20260903.1
```

`@cloudflare/workers-types` must go to v5 in the same command. Leave it out and
npm fails with an `ERESOLVE` peer conflict against wrangler 4.129. That error
names wrangler, which sends you looking in the wrong place — the actual fix is
the types package.

Do not reach for `--force` or `--legacy-peer-deps` here. The conflict is real
and has a correct resolution.

### 2. Content collections

Astro 6 removed legacy content collections. `npm run build` fails with
`LegacyContentConfigError` until this is done.

```bash
git mv src/content/config.ts src/content.config.ts
```

Then give the collection a loader, keeping the existing schema exactly as it is:

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({ /* unchanged */ }),
});

export const collections = { blog };
```

**URLs do not change.** The glob loader derives `id` from the filename, which is
what `slug` used to be. Nothing to redirect — worth confirming on this site
since it has posts and inbound links.

### 3. The API surface that moved

Three renames, all mechanical:

- `post.slug` → `post.id`
- `post.render()` → `render(post)`, with `render` imported from `astro:content`
- `Astro.locals.runtime.env` → `import { env } from 'cloudflare:workers'`

**The third one is the dangerous one.** It does not fail the build. It throws at
request time, so the route returns a 500 that you will only see if you actually
exercise it. On kindacoach.com it was caught by POSTing to the running worker,
not by anything the build said.

Here it appears in **both** `src/pages/api/subscribe.ts` and
`src/pages/api/confirm.ts`. Confirm none are left:

```bash
grep -rn "locals.runtime" src/    # want no output
```

While you are in `src/env.d.ts`: the `Runtime<Env>` / `App.Locals` declaration
describes an API that no longer exists. Keep the `interface Env` block, drop the
rest.

### 4. Rewrite `wrangler.toml`

```toml
name = "flippinflops-com"
main = "@astrojs/cloudflare/entrypoints/server"
compatibility_date = "2026-09-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

# Keep this ON until the domain is cut over. See step 8.
workers_dev = true

[assets]
directory = "./dist/client"
binding = "ASSETS"

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "flippinflops-db"
database_id = "a1b5457f-33ed-45a9-a580-b7a7241fadd8"
```

Adapter 14 changes the build output to `dist/client` + `dist/server`, which is
why `assets.directory` is `./dist/client` and not `./dist`. If you find yourself
adding an `.assetsignore` to hide `_worker.js`, you are on the old layout — the
server bundle now lives outside the assets directory on its own.

### 5. Turn off sessions

```js
// astro.config.mjs
session: false,
```

The Cloudflare adapter enables KV-backed sessions **by default**, which makes
the first deploy try to provision a `SESSION` KV namespace. Nothing in this
codebase touches `Astro.session` — check with
`grep -rn "Astro.session" src/` before accepting this — so it is a namespace
you would never read. Confirm it worked:

```bash
grep -o '"kv_namespaces":\[[^]]*\]' dist/server/wrangler.json   # want []
```

### 6. Verify locally, against the built Worker

Not `astro dev`. The bugs in step 3 only appear in the real runtime.

```bash
npm run build
CLOUDFLARE_ACCOUNT_ID=3fec0e6981622dd93b3889f06ed9532b \
  npx wrangler dev -c dist/server/wrangler.json --local \
  --persist-to .wrangler/state
```

Both flags matter:

- **`CLOUDFLARE_ACCOUNT_ID`** on every wrangler command. The API token cannot do
  the `/memberships` lookup wrangler uses to infer the account. Without it you
  get an authentication error that reads like a broken token and is not one.
- **`--persist-to .wrangler/state`**. Without it, `-c dist/server/wrangler.json`
  resolves local D1 to a *different* directory — you get an empty database and
  `no such table: subscribers`, which looks like a schema problem and is not.

Exercise all three paths and expect exactly this:

| request | expected |
|---|---|
| `GET /` and a post URL | 200 |
| `GET /confirmed` | 200 (prerendered) |
| `POST /api/subscribe` bad address | 400 |
| `POST /api/subscribe` new address | 201, row in local D1 with a `token` |
| same address again | 200, already-subscribed message |
| `GET /api/confirm?token=<that token>` | marks `confirmed = 1` |
| `GET /api/confirm?token=garbage` | the invalid path, not a 500 |

Walk the whole opt-in loop — read the token straight out of local D1 and call
`/api/confirm` with it. A 201 from `subscribe` alone proves nothing about
`confirm.ts`, and `confirm.ts` is where the second copy of the `locals.runtime`
bug lives.

Apply the schema to local D1 first, including the migration:

```bash
CLOUDFLARE_ACCOUNT_ID=3fec0e6981622dd93b3889f06ed9532b \
  npx wrangler d1 execute flippinflops-db --local --file=./schema.sql
```

Delete any test rows afterward. **Local only** — do not point this at `--remote`
while testing, that database has real subscribers.

### 7. Deploy the Worker, without touching the domain

```bash
npm run build
CLOUDFLARE_ACCOUNT_ID=3fec0e6981622dd93b3889f06ed9532b \
  npx wrangler deploy -c dist/server/wrangler.json
```

This creates a Worker named `flippinflops-com` serving on
`flippinflops-com.<subdomain>.workers.dev`. **The live site is untouched** —
`flippinflops.com` is still on Pages at this point.

Verify the workers.dev URL properly: pages render, a post renders, and the
subscribe endpoint returns 400 on a bad address. Do not do a real subscribe test
against production D1 unless you plan to delete the row.

### 8. Cut the domain over

Only once step 7 looks right.

```toml
[[routes]]
pattern = "flippinflops.com"
custom_domain = true
```

Then remove the custom domain from the `flippinflops-com` **Pages** project
first — two services cannot hold the same hostname. Deploy, and watch it.

**The trap that bit kindacoach.com:** adding a `[[routes]]` entry flips
`workers_dev` off by default. If the domain has not finished attaching, the
site is then reachable at *neither* address. Keep `workers_dev = true`
explicitly through the cutover and turn it off in a separate commit once the
apex is confirmed serving.

Also note the token used from the CLI lacks **Zone → DNS → Edit**, so it can
register a custom domain and get a certificate but cannot create the DNS
record. On kindacoach.com the record was ultimately created by the Workers Build
running under its own token. Either widen the CLI token or let the build do it.

### 9. Connect Workers Builds

Dashboard → the `flippinflops-com` Worker → Settings → Builds → connect
`bmichaelis/flippinflops.com`.

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy` — **bare, no `-c` flag.** Verified by
  dry-run: from the repo root it resolves `main` through the package export and
  picks up `dist/client` and the D1 binding on its own.
- Non-production branch: `npx wrangler versions upload` (the default, correct)

Use a **dedicated API token**, not another project's. The dialog will warn about
missing `email_routing_*` permissions — that is noise. Those govern Cloudflare
Email Routing and Email Workers `send_email` bindings, which this site does not
use. Resend is reached by ordinary HTTPS `fetch` and needs no Cloudflare
permission at all.

Token needs: Workers Scripts **Edit**, D1 **Edit**, Account Settings **Read**,
and Zone → DNS **Edit** if you want the build to manage the domain record.

### 10. Clean up

- `workers_dev = false` in its own commit, once the apex is confirmed
- Delete the `flippinflops-com` **Pages** project so there is one deployment path
- Fix `CLAUDE.md` — it currently claims a GitHub auto-deploy that was never true
- Re-set `RESEND_API_KEY`. **Secrets do not carry over from Pages**; it is a
  separate Worker secret:

  ```bash
  CLOUDFLARE_ACCOUNT_ID=3fec0e6981622dd93b3889f06ed9532b \
    npx wrangler secret put RESEND_API_KEY
  ```

  Run it yourself so the value never lands in a transcript. Note this fails
  until the Worker exists, so it has to come after step 7.

---

## Verifying the newsletter, which is easy to get wrong

`subscribe.ts` logs Resend failures and still returns **201**. A working form
proves the D1 write and nothing else.

**Double opt-in makes this worse than it was.** The email that gets swallowed is
now the one carrying the confirmation link. If Resend is misconfigured after the
cutover, subscribers get a cheerful "check your inbox", no mail arrives, and
they can never reach `confirmed = 1`. The form looks healthy while the
newsletter quietly takes on nobody.

So after the cutover, actually walk it: subscribe with a real address, click the
link in the mail, and confirm the row reaches `confirmed = 1`. Also check that
`flippinflops.com` is still verified as a sending domain in Resend, since
`FROM_EMAIL` is `hello@flippinflops.com`.

Before and after, this should read 6 or more, never fewer:

```bash
CLOUDFLARE_ACCOUNT_ID=3fec0e6981622dd93b3889f06ed9532b \
  npx wrangler d1 execute flippinflops-db --remote \
  --command "SELECT COUNT(*) FROM subscribers;"
```

## Reference

`~/repos/kindacoach.com` is the finished version of all this — `wrangler.toml`,
`astro.config.mjs`, `src/content.config.ts`, and `src/pages/api/subscribe.ts`
are the shapes to copy. Its git history walks the migration in order, and the
commit messages record why each change was needed.
