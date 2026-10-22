# Deploying accounts, cloud saves and the hub

The web app works without any server: maps are saved in the browser. Accounts,
cloud saves and the community hub need two extra pieces:

- **Supabase**: sign-in, the Postgres database (with row-level security) and file storage.
- **A Netlify function** (`netlify/functions/publish.mts`, served at `/api/publish`): it
  re-checks every file before a map goes public and is the only thing allowed to write to the hub.

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

- **SQL editor:** open **SQL Editor → New query**, paste all of `supabase/migrations/0001_init.sql` and click **Run**.
- **CLI:** from `web/`, run:
  ```sh
  npx supabase login
  npx supabase link --project-ref <ref>
  npx supabase db push
  ```

The migration creates the tables, policies, functions and the private storage bucket `blobs`.
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
| `HUB_MAX_MAP_MB` | Functions (optional) | Total size cap per published map. Default `60`. Files are also capped at 25 MB each. |
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
3. Save a map to the cloud, publish it, open it from a private window (signed out), and remix it.

For local development against the real Supabase project, put the `VITE_*` values in `.env.local`,
and use `npx netlify dev` so `/api/publish` runs too.

## Security model

**What never leaves the device**

- **The data pack** (`/studio/...` paths): reference files each user extracts from their own copy of the
  desktop package. Projects only point at these paths; recipients of a hub map use their own data pack.
- **Saints Row game files**: any file the app marks as `origin: 'game'`. This covers files picked as a CTS template
  or BBCity donor, and anything whose bytes look like a Saints Row format (BBChunk, BBCity, PVSV, PEG, VPP, CTS
  tables or game file extensions). They're never uploaded to cloud saves or the hub. A cloud save keeps only
  their name and hash, so you have to add them again on another device.
- **Exported maps**: the hub shares projects, never `.chunk_xbox2`/`.vpp` output.

**What is stored privately (only you can read it)**

- Cloud saves: the `cloud_projects` row (project JSON) and your files at `blobs/u/<your-id>/<sha256>`,
  plus thumbnails at `blobs/u/<your-id>/thumbs/<project>.webp`. Row-level security limits both to their owner.

**What is public**

- Profiles: display name, avatar, moderator flag. Email addresses are never shown, and new profiles never
  default to the email name.
- Hub maps that aren't hidden: title, description, tags, counters, the sanitized project snapshot, and their files at
  `blobs/hub/<map>/...`. A hidden map can only be read by its owner and moderators. Deleting a map removes its files.

**How publishing is checked**

1. The browser checks the project first, for clear messages. A map is blocked while any object, material or setting
   uses a game file.
2. The browser uploads any missing user files to your private storage, then saves the project to your cloud.
3. `/api/publish` verifies your session, loads **your stored cloud copy** (not anything sent in the request), and
   runs the same rules (`src/lib/hubRules.ts`) on the stored bytes. It reads the real size and first 4 KB of every file
   and rejects:
   - game signatures and extensions
   - any file that isn't an OBJ/MTL text file or a PNG/JPEG/BMP/GIF/WebP/TGA/DDS/TIFF image
   - files over the size caps
   - invalid titles and tags
   - more publishes than the daily limit

   Only then does it copy the files to `hub/<map>/` with the service role. Browsers can't write to `hub/` at all.
4. Downloads from the hub are checked against their SHA-256 hash in the browser before use.

**Limits and known gaps**

- The server inspects the first 4 KB of each file. A deliberately disguised file (a valid image header with other
  data after it) can get past the format check. Reports (reason **Contains Saints Row game files**) and moderator
  hiding cover this case.
- Storage use per account isn't capped beyond 500 cloud saves and 50 MB per file. Supabase usage dashboards show
  heavy users. Files left over when you delete a cloud save stay in your private storage; content-addressing reuses
  them if you upload them again.
- The download counter can be inflated by anyone calling its RPC, and the remix counter by any signed-in user.
  Likes are one per account. Counters only affect sorting.
