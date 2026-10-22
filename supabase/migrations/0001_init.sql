-- SR1 Map Studio: accounts, cloud saves and the community hub.
--
-- Trust model
--   * Browsers use the anon key and are limited by the RLS policies below.
--   * Only the Netlify function /api/publish (service role) writes hub_maps rows
--     and hub/<mapId>/ storage objects, after re-checking every file.
--   * Saints Row game files never reach this database or storage (the client
--     never uploads origin 'game' files and the function rejects game formats).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  is_moderator boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are public" on public.profiles
  for select to anon, authenticated using (true);
create policy "Users edit their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- is_moderator is only settable with the service role (or the SQL editor).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- Profile for every new account. Uses the OAuth user name when there is one;
-- never the email address, because profiles are public.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := left(trim(coalesce(nullif(meta ->> 'user_name', ''), nullif(meta ->> 'preferred_username', ''), nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), '')), 40);
begin
  if name = '' then name := 'Player-' || left(replace(new.id::text, '-', ''), 6); end if;
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, name, left(nullif(meta ->> 'avatar_url', ''), 500))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_moderator from public.profiles p where p.id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------------
-- cloud saves (private to their owner)
-- ---------------------------------------------------------------------------

create table public.cloud_projects (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null default '' check (char_length(name) <= 200),
  project jsonb not null check (pg_column_size(project) <= 8 * 1024 * 1024),
  size_bytes bigint not null default 0,
  has_thumb boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner, id)
);

create index cloud_projects_owner_updated on public.cloud_projects (owner, updated_at desc);

alter table public.cloud_projects enable row level security;

create policy "Owners manage their cloud saves" on public.cloud_projects
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

revoke all on public.cloud_projects from anon;
grant select, insert, update, delete on public.cloud_projects to authenticated;

-- Insert or update a cloud save with optimistic concurrency: when p_expected
-- is given and the stored copy has a different updated_at, nothing is written
-- and {conflict: true, updated_at} is returned.
create function public.cloud_put(
  p_id text, p_name text, p_project jsonb, p_size bigint,
  p_has_thumb boolean default null, p_expected timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cur timestamptz;
  ts timestamptz := clock_timestamp();
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select c.updated_at into cur from public.cloud_projects c where c.owner = uid and c.id = p_id for update;
  if found then
    if p_expected is not null and cur <> p_expected then
      return jsonb_build_object('conflict', true, 'updated_at', cur);
    end if;
    update public.cloud_projects c
      set name = p_name, project = p_project, size_bytes = p_size,
          has_thumb = coalesce(p_has_thumb, c.has_thumb), updated_at = ts
      where c.owner = uid and c.id = p_id;
  else
    if (select count(*) from public.cloud_projects c where c.owner = uid) >= 500 then
      raise exception 'You have reached the limit of 500 cloud saves.';
    end if;
    insert into public.cloud_projects (owner, id, name, project, size_bytes, has_thumb, created_at, updated_at)
      values (uid, p_id, p_name, p_project, p_size, coalesce(p_has_thumb, false), ts, ts);
  end if;
  return jsonb_build_object('conflict', false, 'updated_at', ts);
end $$;

revoke execute on function public.cloud_put(text, text, jsonb, bigint, boolean, timestamptz) from public, anon;
grant execute on function public.cloud_put(text, text, jsonb, bigint, boolean, timestamptz) to authenticated;

-- Which of these content hashes the caller already stored under u/<uid>/.
create function public.blobs_present(hashes text[]) returns setof text
language sql stable security definer set search_path = '' as $$
  select substr(o.name, char_length(auth.uid()::text) + 4)
  from storage.objects o
  where auth.uid() is not null
    and cardinality(hashes) <= 1000
    and o.bucket_id = 'blobs'
    and o.name = any (select 'u/' || auth.uid()::text || '/' || h from unnest(hashes) as h)
$$;

revoke execute on function public.blobs_present(text[]) from public, anon;
grant execute on function public.blobs_present(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- hub
-- ---------------------------------------------------------------------------

create table public.hub_maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,
  project_id text not null,
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 4000),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  snapshot jsonb not null,            -- sanitized project: user files only
  files jsonb not null default '[]',  -- [{hash, size, name, type}] stored at blobs/hub/<id>/<hash>
  size_bytes bigint not null default 0,
  has_thumb boolean not null default false,
  search tsvector,
  likes integer not null default 0,
  remixes integer not null default 0,
  downloads integer not null default 0,
  hidden boolean not null default false,
  remix_of uuid,
  remix_of_title text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_maps_owner_fkey foreign key (owner) references public.profiles (id) on delete cascade,
  constraint hub_maps_remix_of_fkey foreign key (remix_of) references public.hub_maps (id) on delete set null
);

create index hub_maps_search on public.hub_maps using gin (search);
create index hub_maps_tags on public.hub_maps using gin (tags);
create index hub_maps_new on public.hub_maps (created_at desc) where not hidden;
create index hub_maps_top on public.hub_maps (likes desc, created_at desc) where not hidden;
create index hub_maps_remixed on public.hub_maps (remixes desc, created_at desc) where not hidden;
create index hub_maps_owner on public.hub_maps (owner, updated_at desc);
create index hub_maps_owner_project on public.hub_maps (owner, project_id);

create function public.hub_maps_search_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search :=
       setweight(to_tsvector('simple'::regconfig, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('simple'::regconfig, array_to_string(new.tags, ' ')), 'B')
    || setweight(to_tsvector('simple'::regconfig, coalesce(new.description, '')), 'C');
  return new;
end $$;

create trigger hub_maps_search_update
  before insert or update of title, description, tags on public.hub_maps
  for each row execute function public.hub_maps_search_update();

alter table public.hub_maps enable row level security;

create policy "Visible maps are public" on public.hub_maps
  for select to anon, authenticated
  using (not hidden or owner = auth.uid() or public.is_moderator());
create policy "Moderators hide maps" on public.hub_maps
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy "Owners delete their maps" on public.hub_maps
  for delete to authenticated using (owner = auth.uid());

-- No client inserts; moderators may change only `hidden`.
revoke all on public.hub_maps from anon, authenticated;
grant select on public.hub_maps to anon, authenticated;
grant update (hidden) on public.hub_maps to authenticated;
grant delete on public.hub_maps to authenticated;

-- likes ----------------------------------------------------------------------

create table public.hub_likes (
  map_id uuid not null references public.hub_maps (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (map_id, user_id)
);

create index hub_likes_user on public.hub_likes (user_id);

alter table public.hub_likes enable row level security;

create policy "Users see their likes" on public.hub_likes
  for select to authenticated using (user_id = auth.uid());
create policy "Users like visible maps" on public.hub_likes
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.hub_maps m where m.id = map_id and not m.hidden));
create policy "Users unlike" on public.hub_likes
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.hub_likes from anon, authenticated;
grant select, insert, delete on public.hub_likes to authenticated;

create function public.hub_likes_count() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.hub_maps set likes = likes + 1 where id = new.map_id;
  else
    update public.hub_maps set likes = greatest(likes - 1, 0) where id = old.map_id;
  end if;
  return null;
end $$;

create trigger hub_likes_count
  after insert or delete on public.hub_likes
  for each row execute function public.hub_likes_count();

-- reports --------------------------------------------------------------------

create table public.hub_reports (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null,
  reporter uuid not null default auth.uid(),
  reason text not null check (reason in ('game-data', 'stolen', 'offensive', 'spam', 'broken', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  constraint hub_reports_map_id_fkey foreign key (map_id) references public.hub_maps (id) on delete cascade,
  constraint hub_reports_reporter_fkey foreign key (reporter) references public.profiles (id) on delete cascade
);

create index hub_reports_open on public.hub_reports (created_at desc) where status = 'open';
-- One open report per map and reporter.
create unique index hub_reports_once on public.hub_reports (map_id, reporter) where status = 'open';

alter table public.hub_reports enable row level security;

create policy "Users report maps" on public.hub_reports
  for insert to authenticated with check (reporter = auth.uid() and status = 'open');
create policy "Moderators and reporters read reports" on public.hub_reports
  for select to authenticated using (public.is_moderator() or reporter = auth.uid());
create policy "Moderators resolve reports" on public.hub_reports
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

revoke all on public.hub_reports from anon, authenticated;
grant select on public.hub_reports to authenticated;
grant insert (map_id, reporter, reason, details) on public.hub_reports to authenticated;
grant update (status, resolved_at, resolved_by) on public.hub_reports to authenticated;

-- publish log (rate limiting in the publish function; service role only) ------

create table public.hub_publish_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  map_id uuid,
  created_at timestamptz not null default now()
);

create index hub_publish_log_user on public.hub_publish_log (user_id, created_at desc);

alter table public.hub_publish_log enable row level security;
revoke all on public.hub_publish_log from anon, authenticated;

-- counters -------------------------------------------------------------------

create function public.hub_record_download(map_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.hub_maps m set downloads = m.downloads + 1 where m.id = hub_record_download.map_id and not m.hidden;
$$;

create function public.hub_record_remix(map_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.hub_maps m set remixes = m.remixes + 1 where m.id = hub_record_remix.map_id and not m.hidden;
$$;

create function public.hub_popular_tags(max_tags integer default 24) returns table (tag text, count bigint)
language sql stable security invoker set search_path = '' as $$
  select t, count(*) from public.hub_maps m, unnest(m.tags) as t
  where not m.hidden group by t order by 2 desc, 1 limit least(greatest(max_tags, 1), 100)
$$;

grant execute on function public.hub_record_download(uuid) to anon, authenticated;
revoke execute on function public.hub_record_remix(uuid) from public, anon;
grant execute on function public.hub_record_remix(uuid) to authenticated;
grant execute on function public.hub_popular_tags(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- storage: one private bucket
--   u/<uid>/<sha256>                 cloud-save files (owner only)
--   u/<uid>/thumbs/<projectId>.webp  cloud-save thumbnails (owner only)
--   hub/<mapId>/<sha256>             published files (readable while the map is visible)
--   hub/<mapId>/thumb.webp           published thumbnail
-- ---------------------------------------------------------------------------

-- Uploads are opaque bytes (application/octet-stream) or thumbnails, so nothing
-- in the bucket can be served as HTML or script.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blobs', 'blobs', false, 52428800, array['application/octet-stream', 'image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

create policy "blobs: owners read their files" on storage.objects
  for select to authenticated
  using (bucket_id = 'blobs' and (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "blobs: owners upload their files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blobs' and (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "blobs: owners replace their files" on storage.objects
  for update to authenticated
  using (bucket_id = 'blobs' and (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text)
  with check (bucket_id = 'blobs' and (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "blobs: owners delete their files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'blobs' and (storage.foldername(name))[1] = 'u' and (storage.foldername(name))[2] = auth.uid()::text);

-- Published files: readable by anyone while the map exists and is not hidden
-- (owners and moderators can still read hidden ones). No client writes to hub/.
create policy "blobs: hub files are public" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'blobs' and (storage.foldername(name))[1] = 'hub'
    and exists (
      select 1 from public.hub_maps m
      where m.id::text = (storage.foldername(name))[2]
        and (not m.hidden or m.owner = auth.uid() or public.is_moderator())
    )
  );
