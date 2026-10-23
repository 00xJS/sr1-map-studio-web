-- SR1 Map Studio: the hub becomes the Showcase.
--
-- Showcase maps are built only from the site's own starter textures, generated
-- textures, shapes and prefabs. hub_maps.snapshot holds recipes for those
-- files (src/lib/recipes.ts), never the files, so no user upload goes public
-- except the author's own in-game screenshots (hub/<mapId>/shot-<n>) and the
-- thumbnail. The publish function is still the only writer of hub_maps rows and
-- hub/ objects. Maps published before this migration (with copied user files)
-- stay out of the Showcase: see docs/DEPLOY.md for removing them.

alter table public.hub_maps
  add column showcase boolean not null default false,
  add column shots smallint not null default 0 check (shots between 0 and 6),
  add column rating_count integer not null default 0,
  add column rating_sum integer not null default 0,
  add column rating real generated always as (case when rating_count > 0 then rating_sum::real / rating_count else 0 end) stored;

create index hub_maps_rated on public.hub_maps (rating desc, rating_count desc, created_at desc) where showcase and not hidden;

-- Only Showcase maps are listed; owners and moderators still see their old rows.
drop policy "Visible maps are public" on public.hub_maps;
create policy "Visible maps are public" on public.hub_maps
  for select to anon, authenticated
  using ((showcase and not hidden) or owner = auth.uid() or public.is_moderator());

-- Files of old hub maps stop being public; Showcase screenshots and thumbnails are.
drop policy "blobs: hub files are public" on storage.objects;
create policy "blobs: hub files are public" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'blobs' and (storage.foldername(name))[1] = 'hub'
    and exists (
      select 1 from public.hub_maps m
      where m.id::text = (storage.foldername(name))[2]
        and ((m.showcase and not m.hidden) or m.owner = auth.uid() or public.is_moderator())
    )
  );

-- ratings --------------------------------------------------------------------

create table public.hub_ratings (
  map_id uuid not null references public.hub_maps (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (map_id, user_id)
);

create index hub_ratings_user on public.hub_ratings (user_id);

alter table public.hub_ratings enable row level security;

create policy "Users see their ratings" on public.hub_ratings
  for select to authenticated using (user_id = auth.uid());
create policy "Users rate other people's visible maps" on public.hub_ratings
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.hub_maps m where m.id = map_id and m.showcase and not m.hidden and m.owner <> auth.uid()));
create policy "Users change their rating" on public.hub_ratings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users remove their rating" on public.hub_ratings
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.hub_ratings from anon, authenticated;
grant select, insert, delete on public.hub_ratings to authenticated;
grant update (stars) on public.hub_ratings to authenticated;

create function public.hub_ratings_total() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.hub_maps set rating_count = greatest(rating_count - 1, 0), rating_sum = greatest(rating_sum - old.stars, 0) where id = old.map_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.hub_maps set rating_count = rating_count + 1, rating_sum = rating_sum + new.stars where id = new.map_id;
  end if;
  return null;
end $$;

create trigger hub_ratings_total
  after insert or update of stars or delete on public.hub_ratings
  for each row execute function public.hub_ratings_total();

-- map of the week ------------------------------------------------------------
-- A moderator's pick for the week (weeks start on Monday, UTC); without one,
-- the best-rated Showcase map of the last 7 days (then 30), ranked with a few
-- imaginary 3.5-star votes so one 5-star rating doesn't win outright.

create table public.showcase_featured (
  week date primary key,
  map_id uuid not null references public.hub_maps (id) on delete cascade,
  chosen_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.showcase_featured enable row level security;

create policy "Featured picks are public" on public.showcase_featured
  for select to anon, authenticated using (true);
create policy "Moderators pick the map of the week" on public.showcase_featured
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());

revoke all on public.showcase_featured from anon, authenticated;
grant select on public.showcase_featured to anon, authenticated;
grant insert, update, delete on public.showcase_featured to authenticated;

create function public.showcase_map_of_week() returns uuid
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select f.map_id from public.showcase_featured f
       join public.hub_maps m on m.id = f.map_id and m.showcase and not m.hidden
     where f.week = date_trunc('week', now() at time zone 'utc')::date),
    (select m.id from public.hub_maps m
     where m.showcase and not m.hidden and m.created_at > now() - interval '7 days'
     order by (m.rating_sum + 10.5) / (m.rating_count + 3) desc, m.remixes desc, m.created_at desc limit 1),
    (select m.id from public.hub_maps m
     where m.showcase and not m.hidden and m.created_at > now() - interval '30 days'
     order by (m.rating_sum + 10.5) / (m.rating_count + 3) desc, m.remixes desc, m.created_at desc limit 1)
  )
$$;

grant execute on function public.showcase_map_of_week() to anon, authenticated;

create or replace function public.hub_popular_tags(max_tags integer default 24) returns table (tag text, count bigint)
language sql stable security invoker set search_path = '' as $$
  select t, count(*) from public.hub_maps m, unnest(m.tags) as t
  where m.showcase and not m.hidden group by t order by 2 desc, 1 limit least(greatest(max_tags, 1), 100)
$$;
