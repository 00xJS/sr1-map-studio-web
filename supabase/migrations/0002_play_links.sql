-- Play links: unlisted shares of a map to play in the browser.
--
-- A share holds no files: plain OBJ geometry and texture recipes (generator
-- settings or a starter-library id), checked by the Netlify function
-- netlify/functions/share.mts before it is stored. Only that function (service
-- role) writes this table. Anyone with a link's token can read that one share
-- through get_share(); nobody can list shares or read them by any other key.

create table public.shares (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{22}$'),
  owner uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  -- base64 of the gzip share document
  data text not null check (char_length(data) <= 12 * 1024 * 1024),
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shares_owner_idx on public.shares (owner, updated_at desc);

alter table public.shares enable row level security;

-- Owners can see and remove their own links (the site lists them from the browser,
-- but this keeps the table usable from the dashboard and other clients).
create policy "shares: owner reads" on public.shares for select to authenticated using (owner = auth.uid());
create policy "shares: owner deletes" on public.shares for delete to authenticated using (owner = auth.uid());
-- No insert or update policy: only the service role (the share function) writes.

-- One share by its token. Security definer, so the anon role can call it
-- without any select right on the table (which would allow listing).
create or replace function public.get_share(p_token text)
returns table (title text, data text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.title, s.data, s.created_at, s.updated_at
  from public.shares s
  where p_token ~ '^[A-Za-z0-9_-]{22}$' and s.token = p_token
$$;

revoke all on function public.get_share(text) from public;
grant execute on function public.get_share(text) to anon, authenticated;
