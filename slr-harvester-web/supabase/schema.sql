-- SLR Harvester Web — Supabase Cloud Sync setup
--
-- One-time setup for using Cloud Sync instead of (or alongside) a local
-- folder. This script is never run automatically by the app — paste it into
-- your own Supabase project's SQL editor once, then enable Email auth.
--
-- Steps:
--   1. Create a free project at https://supabase.com. On the creation
--      screen: Postgres (not the OrioleDB alpha option), "Enable Data API"
--      on. "Automatically expose new tables" can stay off either way — this
--      script grants the tables it creates explicit access itself (below),
--      so it doesn't depend on that setting.
--   2. Open the SQL editor (left sidebar) and run this entire file.
--   3. Authentication → Providers (or "Sign In / Providers") → Email →
--      confirm it's enabled. The "require email confirmation" toggle has
--      moved around across Supabase dashboard versions — it's not on the
--      Emails/templates page (that only edits template content); look
--      inside the Email provider's own settings panel, or leave it on and
--      just make sure step 4 below is done, since confirmation emails need
--      that either way.
--   4. Authentication → URL Configuration → add the exact URL this app is
--      served from (e.g. http://localhost:8765/, or your deployed URL) to
--      "Redirect URLs", and set it as the "Site URL" too. Confirmation and
--      magic-link emails are rejected/redirected to Supabase's placeholder
--      http://localhost:3000 otherwise — the #1 cause of "this site can't
--      be reached" after clicking one of those emails.
--   5. Project Settings → API → copy the "Project URL" and the "anon
--      public" key (or, on newer projects, the "Publishable key" —
--      sb_publishable_... — which replaces it and works the same way here).
--   6. In SLR Harvester Web, click "Sign Up" on the Home screen (or paste
--      both into Settings → Cloud Sync first, if using a different project
--      than the one already built into the app).
--
-- The anon/publishable key is safe to use client-side — it's designed to be public.
-- Row Level Security (enabled below) is what actually protects the data:
-- every policy is scoped to auth.uid(), so signed-in users can only ever
-- see or change their own rows.

-- ── projects ──────────────────────────────────────────────────────────────
-- One row per project. The five JSONB columns mirror the five JSON files a
-- local-folder project stores on disk (search_log.json, slr_global_tags.json,
-- tags_config.json, tag_aliases.json, query_history.json) — every read/write
-- in the app already treats each of those as one whole document, so this
-- mirrors that shape 1:1 instead of a normalized redesign.
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  description       text default 'No description',
  created           date not null default current_date,
  workspace_folder  text not null,           -- same "YYYYMMDD_HHMMSS" id shape as local
  search_log        jsonb not null default '[]'::jsonb,
  global_tags       jsonb not null default '{}'::jsonb,
  tags_config       jsonb not null default '{}'::jsonb,
  tag_aliases       jsonb not null default '{}'::jsonb,
  query_history     jsonb not null default '{"terms":[]}'::jsonb,
  updated_at        timestamptz not null default now(),
  unique (user_id, workspace_folder)
);

create index projects_user_id_idx on public.projects(user_id);

-- ── user_settings ─────────────────────────────────────────────────────────
-- One row per user; equivalent of slr_config.json (API keys).
create table public.user_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  api_key        text,
  inst_token     text,
  openalex_key   text,
  openalex_email text,
  updated_at     timestamptz not null default now()
);

-- ── Grants ────────────────────────────────────────────────────────────────
-- Newer Supabase projects default "Automatically expose new tables" to OFF
-- (Project Creation → Security) — a table you create no longer automatically
-- gets Data API access for anon/authenticated just by existing. Without
-- these explicit grants, RLS policies below would be correctly configured
-- but never even reached, since the API role couldn't touch the tables at
-- all. Only `authenticated` gets access — nothing here is ever read before
-- sign-in, so `anon` needs none of it.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update on public.user_settings to authenticated;

-- ── Row Level Security ────────────────────────────────────────────────────
alter table public.projects enable row level security;
alter table public.user_settings enable row level security;

create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

create policy "settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep updated_at fresh (useful groundwork for future conflict/sync UX).
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ── Atomic write helpers ──────────────────────────────────────────────────
-- The app's read-then-write functions (tag edits, search-log patches, etc.)
-- aren't fully atomic against a second open tab/device — an accepted,
-- documented limitation (see the project's migration plan) that matches the
-- local-folder backend's own single-writer assumption. These two functions
-- cover the two highest-frequency writes with a single atomic statement
-- instead, removing the race for exactly those two paths:
--
--   append_search_log  — prepending a new search run never needs to read
--                         the existing log first.
--   merge_global_tags   — merging tag/annotation updates only overwrites the
--                         specific article ids being changed, so two tabs
--                         editing different articles concurrently can't
--                         clobber each other (same-article-same-instant is
--                         still last-write-wins, same as local-folder mode).
--
-- security invoker (the default) means these still run as the calling user,
-- so the "and user_id = auth.uid()" guard below is what actually enforces
-- RLS-equivalent scoping inside the function body.

create or replace function public.append_search_log(p_workspace_folder text, p_entry jsonb)
returns void
language sql
as $$
  update public.projects
  set search_log = jsonb_build_array(p_entry) || search_log
  where workspace_folder = p_workspace_folder and user_id = auth.uid();
$$;

create or replace function public.merge_global_tags(p_workspace_folder text, p_updates jsonb)
returns void
language sql
as $$
  update public.projects
  set global_tags = global_tags || p_updates
  where workspace_folder = p_workspace_folder and user_id = auth.uid();
$$;

grant execute on function public.append_search_log(text, jsonb) to authenticated;
grant execute on function public.merge_global_tags(text, jsonb) to authenticated;
