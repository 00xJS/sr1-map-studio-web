-- Play links grow up: anonymous links that expire, a gallery of maps built
-- only from the site's own models, reports, ratings and time-trial boards.
--
-- Still true from 0002: only the share function (service role) writes shares,
-- and nothing lists links except list_gallery(), which shows only the ones
-- their signed-in owner chose to list. Anonymous links (made without an
-- account) expire after 30 days; a scheduled function
-- (netlify/functions/share-expiry.mts) deletes them and their thumbnails.
-- Moderators hide links through the share function too, so the preview
-- picture goes at once (storage objects can only be removed through its API).

alter table public.shares
  alter column owner drop not null,
  -- Made without an account: no owner, an expiry date, and edited only with the key the maker's browser keeps.
  add column anon boolean not null default false,
  add column expires_at timestamptz,
  -- Salted hash of the maker's IP address (anonymous links only), for the daily limit. Never the address itself.
  add column ip_hash text,
  -- SHA-256 of the anonymous maker's edit key.
  add column key_hash text,
  -- Shown in the gallery (signed-in owners only, and only maps whose models were all made on the site).
  add column listed boolean not null default false,
  -- Hidden by a moderator: the link stops working.
  add column hidden boolean not null default false,
  -- When the preview picture (storage: share-thumbs/<token>.webp) was last stored; null for none. It is drawn
  -- from the share itself, or (shot) an in-game screenshot the author took of the map.
  add column thumb timestamptz,
  add column shot boolean not null default false,
  add column plays integer not null default 0,
  -- SHA-256 of the stored share: a board's times only count for the map they were run on.
  add column data_hash text,
  -- What the link page shows before the map loads (link previews, the gallery).
  add column modes text[] not null default '{}',
  add column players smallint not null default 0 check (players between 0 and 64),
  add column rating_count integer not null default 0,
  add column rating_sum integer not null default 0,
  add column rating real generated always as (case when rating_count > 0 then rating_sum::real / rating_count else 0 end) stored,
  add constraint shares_who check ((anon and owner is null and expires_at is not null) or (not anon and owner is not null)),
  add constraint shares_listed_owner check (not (listed and anon));

create index shares_gallery on public.shares (created_at desc) where listed and not hidden;
create index shares_expiry on public.shares (expires_at) where expires_at is not null;
create index shares_ip on public.shares (ip_hash, created_at desc) where ip_hash is not null;

-- Moderators see every link (the moderation queue shows titles). Hiding one goes through the share function.
create policy "shares: moderators read" on public.shares for select to authenticated using (public.is_moderator());
revoke insert, update on public.shares from anon, authenticated;

-- What the share function counts for its limits: links made and updated without an account, and plays
-- (one per address, link and day). Salted address hashes only; rows older than two days are deleted daily.
create table public.share_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('create', 'update', 'play')),
  ip_hash text not null,
  token text,
  created_at timestamptz not null default now()
);

create index share_log_ip on public.share_log (ip_hash, kind, created_at desc);
create index share_log_token on public.share_log (token, ip_hash, kind, created_at desc);

alter table public.share_log enable row level security;
revoke all on public.share_log from anon, authenticated;

-- A share by its token, unless it expired or a moderator hid it. The link
-- preview (netlify/edge-functions/og.ts) asks for the small columns only.
drop function public.get_share(text);
create function public.get_share(p_token text)
returns table (title text, data text, created_at timestamptz, updated_at timestamptz, expires_at timestamptz,
               thumb timestamptz, shot boolean, modes text[], players smallint, listed boolean, plays integer)
language sql stable security definer set search_path = '' as $$
  select s.title, s.data, s.created_at, s.updated_at, s.expires_at, s.thumb, s.shot, s.modes, s.players, s.listed, s.plays
  from public.shares s
  where p_token ~ '^[A-Za-z0-9_-]{22}$' and s.token = p_token
    and not s.hidden and (s.expires_at is null or s.expires_at > now())
$$;

revoke all on function public.get_share(text) from public;
grant execute on function public.get_share(text) to anon, authenticated;

-- The gallery: listed, not hidden, not expired. Sorted 'new', 'top' (rated, with a
-- few imaginary 3.5-star votes so one 5-star rating doesn't win outright) or 'played'.
create function public.list_gallery(p_search text default '', p_sort text default 'new', p_limit integer default 48, p_offset integer default 0)
returns table (token text, title text, thumb timestamptz, shot boolean, modes text[], players smallint, plays integer,
               rating real, rating_count integer, owner uuid, author_name text, author_avatar text,
               created_at timestamptz, updated_at timestamptz, total bigint)
language sql stable security definer set search_path = '' as $$
  select s.token, s.title, s.thumb, s.shot, s.modes, s.players, s.plays, s.rating, s.rating_count, s.owner,
         p.display_name, p.avatar_url, s.created_at, s.updated_at, count(*) over ()
  from public.shares s
  left join public.profiles p on p.id = s.owner
  where s.listed and not s.hidden and (s.expires_at is null or s.expires_at > now())
    and (coalesce(p_search, '') = '' or s.title ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or p.display_name ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by
    case when p_sort = 'top' then (s.rating_sum + 10.5) / (s.rating_count + 3) end desc nulls last,
    case when p_sort = 'played' then s.plays end desc nulls last,
    s.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;

grant execute on function public.list_gallery(text, text, integer, integer) to anon, authenticated;

-- Someone opened a link to play it. Only the share function calls this, once per address, link and day.
create function public.record_share_play(p_token text) returns void
language sql security definer set search_path = '' as $$
  update public.shares s set plays = s.plays + 1
  where s.token = p_token and not s.hidden and (s.expires_at is null or s.expires_at > now());
$$;

revoke all on function public.record_share_play(text) from public, anon, authenticated;

-- Preview pictures: public, small WebP images written only by the share function (checked first).
-- Like the Showcase's screenshots, the only game graphics that go public are an author's own in-game screenshot.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-thumbs', 'share-thumbs', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- reports --------------------------------------------------------------------
-- Anyone who opens a link can report it (no account needed), so reports go
-- through the share function, which limits them per IP hash. Moderators read
-- and resolve them here.

create table public.share_reports (
  id uuid primary key default gen_random_uuid(),
  token text not null references public.shares (token) on delete cascade,
  reason text not null check (reason in ('game-data', 'stolen', 'offensive', 'spam', 'broken', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  reporter uuid references public.profiles (id) on delete set null,
  ip_hash text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

create index share_reports_open on public.share_reports (created_at desc) where status = 'open';
create index share_reports_ip on public.share_reports (ip_hash, created_at desc);
create unique index share_reports_once_user on public.share_reports (token, reporter) where status = 'open' and reporter is not null;
create unique index share_reports_once_ip on public.share_reports (token, ip_hash) where status = 'open' and ip_hash is not null;

alter table public.share_reports enable row level security;

create policy "Moderators read share reports" on public.share_reports
  for select to authenticated using (public.is_moderator());
create policy "Moderators resolve share reports" on public.share_reports
  for update to authenticated using (public.is_moderator()) with check (public.is_moderator());

revoke all on public.share_reports from anon, authenticated;
grant select on public.share_reports to authenticated;
grant update (status, resolved_at, resolved_by) on public.share_reports to authenticated;

-- ratings --------------------------------------------------------------------

create table public.share_ratings (
  token text not null references public.shares (token) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (token, user_id)
);

create index share_ratings_user on public.share_ratings (user_id);

alter table public.share_ratings enable row level security;

-- Raters can't see other people's links, so rating goes through rate_share() rather than table rights.
create policy "Users see their share ratings" on public.share_ratings
  for select to authenticated using (user_id = auth.uid() or public.is_moderator());

revoke all on public.share_ratings from anon, authenticated;
grant select on public.share_ratings to authenticated;

-- 1 to 5 stars for someone else's listed, visible, unexpired link; 0 takes the rating back.
create function public.rate_share(p_token text, p_stars integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in to rate maps.' using errcode = '42501'; end if;
  if p_stars is null or p_stars < 0 or p_stars > 5 then raise exception 'Ratings are 1 to 5 stars.' using errcode = '22023'; end if;
  if not exists (select 1 from public.shares s where s.token = p_token and s.listed and not s.hidden
                   and (s.expires_at is null or s.expires_at > now()) and s.owner is distinct from me) then
    raise exception 'This map can''t be rated.' using errcode = '42501';
  end if;
  if p_stars = 0 then
    delete from public.share_ratings where token = p_token and user_id = me;
  else
    insert into public.share_ratings (token, user_id, stars) values (p_token, me, p_stars)
    on conflict (token, user_id) do update set stars = excluded.stars;
  end if;
end $$;

revoke all on function public.rate_share(text, integer) from public, anon;
grant execute on function public.rate_share(text, integer) to authenticated;

create function public.share_ratings_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.shares set rating_count = greatest(rating_count - 1, 0), rating_sum = greatest(rating_sum - old.stars, 0) where token = old.token;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.shares set rating_count = rating_count + 1, rating_sum = rating_sum + new.stars where token = new.token;
  end if;
  return null;
end $$;

create trigger share_ratings_total
  after insert or update of stars or delete on public.share_ratings
  for each row execute function public.share_ratings_total();

-- time trials ----------------------------------------------------------------
-- Best times per link and run, with the run's ghost ([t, x, y, z, heading]
-- samples, src/play/ghost.ts). The share function checks each time against
-- the map before storing it and keeps the 50 best per board.

create table public.share_times (
  id bigint generated always as identity primary key,
  token text not null references public.shares (token) on delete cascade,
  mode text not null check (mode in ('weapons', 'dropoffs')),
  name text not null check (char_length(name) between 1 and 24),
  ms integer not null check (ms between 1000 and 3600000),
  ghost jsonb not null,
  player uuid references auth.users (id) on delete set null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index share_times_board on public.share_times (token, mode, ms, created_at);
create index share_times_ip on public.share_times (ip_hash, created_at desc);

alter table public.share_times enable row level security;

-- Boards are read through share_board() and share_ghost(); moderators can also clean them up directly.
create policy "Moderators read times" on public.share_times
  for select to authenticated using (public.is_moderator());
create policy "Moderators remove times" on public.share_times
  for delete to authenticated using (public.is_moderator());

revoke all on public.share_times from anon, authenticated;
grant select, delete on public.share_times to authenticated;

create function public.share_board(p_token text, p_mode text, p_limit integer default 10)
returns table (id bigint, name text, ms integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.name, t.ms, t.created_at
  from public.share_times t join public.shares s on s.token = t.token
  where t.token = p_token and t.mode = p_mode and not s.hidden and (s.expires_at is null or s.expires_at > now())
  order by t.ms, t.created_at
  limit least(greatest(p_limit, 1), 50)
$$;

-- A ghost needs its link's token as well as its row, so nobody can walk the ids to find unlisted links' runs.
create function public.share_ghost(p_token text, p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select t.ghost
  from public.share_times t join public.shares s on s.token = t.token
  where t.token = p_token and t.id = p_id and not s.hidden and (s.expires_at is null or s.expires_at > now())
$$;

grant execute on function public.share_board(text, text, integer) to anon, authenticated;
revoke all on function public.share_ghost(text, bigint) from public;
grant execute on function public.share_ghost(text, bigint) to anon, authenticated;
