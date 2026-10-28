# Deploying accounts, cloud saves and the Showcase

The web app works without any server: maps are saved in the browser. Accounts,
cloud saves and the community Showcase need two extra pieces:

- **Supabase**: sign-in, the Postgres database (with row-level security) and file storage.
- **A Netlify function** (`netlify/functions/publish.mts`, served at `/api/publish`): it
  re-checks every map before it goes in the Showcase and is the only thing allowed to write to it.

To try everything without a server, set `VITE_BACKEND=local` in `.env.local` and run
`npm run dev`. The app then simulates the server in this browser's IndexedDB
(`sr1-local-server`). The first account you sign in with becomes a moderator.

## 1. Create the Supabase project

1. Sign in at <https://supabase.com> and create a project. Choose a strong database password and the region nearest your players.
2. Open **Project Settings → API** and note:
   - the **Project URL** (`https://<ref>.supabase.co`)
   - the **anon public** key (it's safe in the browser)
   - the **service_role** key (secret: the Netlify function is the only place it goes)

## 2. Run the migration

Use one of these:

- **SQL editor:** open **SQL Editor → New query**, paste all of `supabase/migrations/0001_init.sql` and click **Run**,
  then do the same with `supabase/migrations/0003_showcase.sql`.
- **CLI:** from `web/`, run:
  ```sh
  npx supabase login
  npx supabase link --project-ref <ref>
  npx supabase db push
  ```

The migrations create the tables, policies, functions and the private storage bucket `blobs`;
`0003_showcase.sql` adds ratings, the map of the week and the Showcase rules (see below).
Check under **Storage** that `blobs` exists and is **not public**. If the migration couldn't create it
(some projects restrict the `storage` schema), create it by hand:

- Name `blobs`. Leave **Public bucket** off.
- File size limit: 50 MB.
- Allowed MIME types: `application/octet-stream, image/webp, image/png, image/jpeg`.

Then run the `create policy ... on storage.objects` statements at the end of the migration again.

## 3. Configure sign-in

**Authentication → URL Configuration**

- **Site URL**: `https://<your-site>.netlify.app` (or your own domain).
- **Redirect URLs**: add
  - `https://<your-site>.netlify.app/account`
  - `https://*--<your-site>.netlify.app/**` (Netlify deploy previews, optional)
  - `http://localhost:5173/account` (local development)

**Authentication → Providers**

- **Email**: enabled by default and used for magic links. For real traffic, set up custom SMTP
  (**Project Settings → Authentication → SMTP**), because Supabase's built-in mailer is heavily rate-limited.
- **GitHub** (optional): create an OAuth app at <https://github.com/settings/developers> with the callback URL
  `https://<ref>.supabase.co/auth/v1/callback`, then paste its client ID and secret into the GitHub provider.
- **Discord** (optional): create an application at <https://discord.com/developers/applications>. Under **OAuth2**, add the
  redirect `https://<ref>.supabase.co/auth/v1/callback`, then paste the client ID and secret into the Discord provider.
- **Google** works the same way if you want it. The sign-in page shows the buttons listed in `VITE_AUTH_PROVIDERS` (see step 5).

## 4. Make yourself a moderator

Sign in on the deployed site once (this creates your profile), then run this in the SQL editor:

```sql
update public.profiles
set is_moderator = true
where id = (select id from auth.users where email = 'you@example.com');
```

Only the service role or the SQL editor can change `is_moderator`. Moderators see a **Moderation**
section on the Account page, and can hide or unhide any hub map.

## 5. Netlify environment variables

**Site configuration → Environment variables**:

| Variable | Scope | Value |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Builds | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Builds | anon public key |
| `VITE_AUTH_PROVIDERS` | Builds (optional) | Sign-in buttons, comma-separated, from `github`, `discord`, `google`. Default `github,discord`. Leave empty for email only. |
| `SUPABASE_URL` | Functions | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Functions | service_role key. **Never** give this a `VITE_` prefix: anything with that prefix is built into the public JavaScript. |
| `HUB_MAX_PUBLISH_PER_DAY` | Functions (optional) | Publishes (new or updated maps) per user per 24 hours. Default `20`. |

Leave `VITE_BACKEND` unset in production.

## 6. Deploy

`netlify.toml` already builds with `npm run build`, publishes `dist/` and deploys functions from
`netlify/functions`. Connect the repository in Netlify (set the base directory to `web` if the repo
root is above it), or deploy from the CLI:

```sh
npx netlify deploy --build --prod
```

Then check:

1. `POST https://<site>/api/publish` without a token returns `401 {"error":"Sign in first."}`.
   If it returns the HTML of the app instead, the SPA catch-all redirect is catching the function. Delete
   the `export const config = { path: '/api/publish' }` line from `netlify/functions/publish.mts` (a function
   with a custom path isn't served at its default URL), and add this rule **above** the `/*` redirect in
   `netlify.toml`:
   ```toml
   [[redirects]]
     from = "/api/publish"
     to = "/.netlify/functions/publish"
     status = 200
     force = true
   ```
2. Sign in with a magic link and check that you land on `/account` signed in.
3. Start a sample map, publish it to the Showcase with a screenshot, open it from a private window (signed out),
   and remix it. Sign in as someone else and rate it.

For local development against the real Supabase project, put the `VITE_*` values in `.env.local`,
and use `npx netlify dev` so `/api/publish` runs too.

## Security model

**What never leaves the device**

- **The data pack** (`/studio/...` paths): reference files each user extracts from their own copy of the
  desktop package. Projects only point at these paths; people who remix a Showcase map use their own data pack.
- **Saints Row game files**: any file the app marks as `origin: 'game'`. This covers files picked as a CTS template
  or BBCity donor, and anything whose bytes look like a Saints Row format (BBChunk, BBCity, PVSV, PEG, VPP, CTS
  tables or game file extensions). They're never uploaded to cloud saves or the Showcase. A cloud save keeps only
  their name and hash, so you have to add them again on another device.
- **Exported maps**: the Showcase shares how a map is built, never `.chunk_xbox2`/`.vpp` output.
- **Files the user imported** (their own models, photos, textures): cloud saves keep them privately, but the
  Showcase never takes them, so a user upload can't end up public. See below.

**What is stored privately (only you can read it)**

- Cloud saves: the `cloud_projects` row (project JSON) and your files at `blobs/u/<your-id>/<sha256>`,
  plus thumbnails at `blobs/u/<your-id>/thumbs/<project>.webp`. Row-level security limits both to their owner.

**What is public**

- Profiles: display name, avatar, moderator flag. Email addresses are never shown, and new profiles never
  default to the email name.
- Showcase maps that aren't hidden: title, description, tags, counters, average rating, the map's snapshot, and the
  author's screenshots and thumbnail at `blobs/hub/<map>/shot-<n>` and `thumb.webp`. A hidden map can only be read by
  its owner and moderators. Deleting a map removes its pictures. Individual ratings are private to the person who gave them.

**What the Showcase accepts**

The Showcase only takes maps built from Map Studio's own pieces: the starter-library textures (CC0, served by the
site from `public/textures/`), generated textures, block-out shapes and prefabs. When the site makes one of those
files it records a **recipe** on the file (`src/lib/recipes.ts`): the library id, the generator settings, or the
shapes a mesh is made of. The Showcase stores the map with recipes only and **no files**; remixing rebuilds every
texture and mesh in the remixer's browser from the recipes. So nothing a user uploaded (a photo, a model from a
download site, a texture ripped from another game) can be published, by construction rather than by inspection.
The only uploaded images are the author's in-game screenshots (up to 6) and the thumbnail.

**How publishing is checked**

1. The browser checks the map first, for clear messages (`showcasePlan` in `src/lib/hubRules.ts`): every object's
   model and textures, and the map's sky, custom minimap and loading pictures, must have a valid recipe or be a
   data-pack path. Maps made before recipes were recorded get them back where they can be proven (shape meshes from
   the object's shape settings, starter textures whose bytes match the library copy); anything else needs repainting.
2. The browser uploads the screenshots and thumbnail to your private storage and sends the map's Showcase copy
   (recipes, no files) to `/api/publish`.
3. `/api/publish` verifies your session and runs the same rules on what it was sent. It rejects unknown starter
   textures, out-of-range generator or shape settings, files without a recipe, invalid titles and tags, more
   publishes than the daily limit, and maps over 5 MB of data; it strips private paths and rewrites recipes field
   by field so nothing else rides along. It reads the real size and first 4 KB of each picture from your private
   storage and accepts only PNG, JPEG or WebP up to 2 MB.

   Only then does it copy the pictures to `hub/<map>/` with the service role and write the row. Browsers can't
   write to `hub/` at all.

**Ratings and the map of the week**

- One rating (1 to 5 stars) per account per map, not on your own maps; a trigger keeps each map's count and average.
- The map of the week is a moderator's pick (**Make map of the week** on the map page, kept in `showcase_featured`
  until Monday UTC). Without a pick it is the best-rated map published in the last 7 days (then 30), ranked as if it
  had three extra 3.5-star ratings so one 5-star vote doesn't win outright.

**Limits and known gaps**

- Screenshots are the author's word: one that isn't theirs can be reported (**Someone else's work without credit**)
  and hidden by a moderator.
- Storage use per account isn't capped beyond 500 cloud saves and 50 MB per file. Supabase usage dashboards show
  heavy users. Files left over when you delete a cloud save stay in your private storage; content-addressing reuses
  them if you upload them again.
- The download counter can be inflated by anyone calling its RPC, and the remix counter by any signed-in user.
  Ratings are one per account. Counters only affect sorting.

**Maps published to the old hub**

Before `0003_showcase.sql`, the hub copied users' own files. The migration takes those maps out of the listing and
makes their files private (`showcase = false`); their owners can publish them again if they pass the Showcase rules.
To delete them for good, run `delete from public.hub_maps where not showcase;` and remove their folders under
`blobs/hub/` in the Storage browser.

## Play links

**Share** in the editor makes a link anyone can open to play the map in their browser at
`/play/s/<token>`: no game, no account, phones included. Links are unlisted (a random
128-bit token; nothing lists them) and the public hub can stay off.

A share holds **no files**. It carries the map's markers and lights, its geometry as plain OBJ
text (numbers only: comments and material libraries are dropped), and each texture as a
**recipe**: the generator settings, or the id of a CC0 starter-library texture (the same recipes
the Showcase uses, `src/lib/recipes.ts`; links made before the two were merged still open). The
viewer's browser remakes the textures. So a share can't contain anyone's pictures or any Saints Row file:

- textures the site didn't make (uploads, photos, imported models' images) block the share,
  unless the user agrees to swap them for a plain generated stand-in;
- objects whose model is a game file (`origin: 'game'`) are left out;
- data-pack objects (`/studio/...`, such as native glass) are referenced by path only, and show
  only for players who loaded their own data pack;
- the SR1 character is never in a share: players load their own from their game folder.

Hosting a link needs:

1. The migration `supabase/migrations/0002_play_links.sql` (run it like step 2). It adds the
   `shares` table (written only by the service role) and the `get_share(token)` function that
   lets anyone read one share by its token.
2. The Netlify function `netlify/functions/share.mts` (`/api/share`). It uses the same
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as the publish function, signs the user in from
   their token, unpacks the share and checks it with `src/play/share.ts` before storing it.
   If `/api/share` returns the app's HTML, apply the same redirect fix as for `/api/publish`
   (step 6), with `/api/share` and `/.netlify/functions/share`.

That is enough for signed-in links. The rest of play links (links without an account, the
gallery, preview pictures, reports, ratings and time-trial boards) needs:

3. The migration `supabase/migrations/0004_share_gallery.sql`, run after `0002`. It adds the
   expiry, gallery, report, rating and board columns and tables, the limit log `share_log`, the
   public `share-thumbs` bucket (640×360 WebP pictures the site draws, written only by the share
   function), and the `get_share` and `list_gallery` functions. From this migration on, owners
   remove their links only through the share function, so a link's picture goes with it.
   Until it is applied, signed-in links keep working and everything else answers "not open yet".
4. `SHARE_IP_SALT` (Functions): a long random secret, for example the output of
   `openssl rand -hex 32`. Links without an account, reports and board times are limited per
   salted hash of the maker's address (IPv6 by its /64 network); the address itself is never
   stored. Without a salt nothing anonymous is allowed: links need an account. Changing it resets
   the counts.
5. The link preview, the edge function `netlify/edge-functions/og.ts` (on `/play/s/*`). It puts
   the map's title and picture in the page's head, so a link posted in a chat unfurls as the
   map. It needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at run time too: give both
   the **Edge Functions** scope as well as Builds. Without them, links unfurl with the site's own picture.
6. The daily job `netlify/functions/share-expiry.mts` (scheduled `@daily`; Netlify runs it on
   its own once deployed). It deletes expired links without an account with their pictures,
   reports, ratings and times, removes hidden links' pictures, and clears the limit log after
   two days. It uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
7. A moderator (step 4 above). In the **Moderation** section of the Account page, moderators see
   reported links and can hide one, which stops it opening, takes it out of the gallery and removes its
   picture. They also see **pictures waiting**: a signed-in link's preview picture shows in link previews and the
   gallery only once a moderator approves it (until then, and when it is turned down, the link shows the site's
   own picture). A new picture waits again. Approving and turning down go through the share function.

Optional function variables:

| Variable | Value |
| --- | --- |
| `SHARES_ENABLED` | `false` stops new links (removing them still works). Default on. |
| `SHARE_MAX_PER_DAY` | Links made or updated per user per 24 hours (each update counts). Default `50`. |
| `SHARE_MAX_PER_USER` | Links one user can have. Default `200`. |
| `SHARE_ANON_PER_DAY` | Links made without an account per address per 24 hours. Default `10`. |
| `SHARE_ANON_UPDATES_PER_DAY` | Updates of links made without an account, per address per 24 hours. Default `30`. |
| `SHARE_REPORTS_PER_DAY` | Reports per address per 24 hours. Default `20`. |
| `SHARE_TIMES_PER_HOUR` | Board times sent per address (or account) per hour, refused ones included. Default `60`. |
| `SHARE_ATTEMPTS_PER_HOUR` | Tries at making or updating a link per account (or address) per hour, failed ones included. Default `30`. |

Each share is capped at 8 MB packed (`SHARE_LIMITS` in `src/play/share.ts`). The function checks
every limit before it reads a share, stores the share rebuilt from only the fields a share may
hold (`src/play/shareSchema.ts`), and lists a map in the gallery only after rebuilding every
model from its settings (`src/play/shareBuilds.ts`), which takes a couple of seconds at most.

Without Supabase (accounts off), **Share** offers a `.sr1play` file instead; the other person
opens it at `/play`. With `VITE_BACKEND=local`, links are simulated in this browser's IndexedDB
(`sr1-local-shares`), so they only open in the same browser.

## Turning the Showcase on or off

The Showcase is **off** unless both of these are set (sign-in and cloud saves work either way):

- `VITE_HUB=on` (Builds): shows the Showcase page and the Publish button.
- `HUB_ENABLED=true` (Functions): lets `/api/publish` accept new maps. Unpublishing always works.

Run `0003_showcase.sql` before turning it on. To try it without a server, set `VITE_BACKEND=local` (the simulated
server turns the Showcase on unless `VITE_HUB=off`).

With the Showcase off, players share maps with **Backup** (a `.sr1map.zip` with every file) and **Import project…**.
