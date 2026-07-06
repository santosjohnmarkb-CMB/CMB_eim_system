-- ═══════════════════════════════════════════════════════════════════════════
-- CMB EIM — Supabase READ-ONLY inventory / pre-hardening verification
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose: understand the CURRENT state of the shared Supabase project BEFORE
-- applying any Row Level Security (RLS) change. This script is 100% read-only —
-- it runs only SELECTs against Postgres catalog views and creates/alters/drops
-- NOTHING. Safe to run on production at any time.
--
-- Run it in: Supabase Dashboard → SQL Editor → New query → Run.
-- Read the four result grids top-to-bottom.
--
-- What you are checking:
--   1. Which tables exist, and whether RLS is enabled on each.
--   2. The exact policies in force (the "USING(true)"/"WITH CHECK(true)" ones are
--      the CRIT-2 finding — they grant the public `anon` role full access).
--   3. Which role each policy applies to (`public` = anon + authenticated;
--      `anon` = key-only requests; `authenticated` = logged-in requests).
--   4. Row counts, so you can sanity-check which tables actually hold data.
--
-- The goal is to confirm that the EIM-exclusive tables (parts_*, maintenance_*,
-- equipment_assets, equipment_loans, purchase_requests, preventive_schedules,
-- ticket_actions, asset_status_log, and — verify! — vendors) are NOT used by the
-- other two apps, so tightening their RLS to `authenticated` cannot affect them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. All public tables + whether RLS is enabled ───────────────────────────
SELECT
  c.relname                       AS table_name,
  c.relrowsecurity                AS rls_enabled,
  c.relforcerowsecurity           AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ── 2. Every RLS policy, its command, roles, and expressions ────────────────
-- Look for `qual = true` / `with_check = true` on tables you intend to lock down.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd                              AS applies_to_command,   -- ALL / SELECT / INSERT / ...
  roles                            AS applies_to_roles,     -- {public} = anon+authenticated
  qual                             AS using_expression,
  with_check                       AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ── 3. Tables published to Realtime ─────────────────────────────────────────
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- ── 4. Row counts per table (approximate, from planner stats — read-only) ────
-- Use this to eyeball which tables hold data. If `vendors` (or any EIM table)
-- has rows that predate your EIM rollout, that is a hint it may be shared.
SELECT
  relname          AS table_name,
  n_live_tup       AS approx_row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC, relname;
