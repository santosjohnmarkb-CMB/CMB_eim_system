-- ═══════════════════════════════════════════════════════════════════════════
-- CMB EIM — Supabase RLS HARDENING (CRIT-2)  ⚠️ OPT-IN, RUN ONLY AFTER VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES
--   Replaces the permissive `FOR ALL USING(true)` policies (which apply to the
--   public `anon` role — i.e. anyone holding the public anon key) on the
--   EIM-EXCLUSIVE tables with policies scoped to the `authenticated` role.
--   After this runs, a client holding ONLY the public anon key can no longer
--   read or write EIM data; the EIM app must sign in as its Supabase Auth
--   service account (see PREREQUISITES) to keep working.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   The tables SHARED with the rental app(s):
--       users, equipment_items, categories, subcategories,
--       package_definitions, package_items
--   Their policies are left exactly as-is, so the other two apps (which use the
--   anon key) are UNAFFECTED. Do not add those tables to the list below.
--
-- PREREQUISITES (do these first, in order):
--   1. Run `supabase-verify.sql` and confirm every table in EIM_TABLES below is
--      used ONLY by this EIM app (grep the other repos for the names too).
--   2. In Supabase → Authentication → Users, create ONE service account
--      (e.g. eim-sync@cmb.internal) with a strong password. Disable public
--      sign-ups if you don't want others creating accounts.
--   3. In the EIM app (admin), save that service credential (Settings → Sync,
--      or the `sync:serviceAccount:set` IPC). Confirm the app shows it is
--      signed in / syncing while ONLINE.
--   4. ONLY THEN run this script. If you run it before step 3, the EIM app will
--      lose cloud access until the credential is configured (local data is safe;
--      it simply queues and reconnects once authenticated).
--
-- ROLLBACK: see the clearly-marked section at the bottom.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── EIM-exclusive tables → authenticated-only ───────────────────────────────
-- `vendors` is intentionally EXCLUDED here and handled in its own gated block
-- below, because its generic name means it is the most likely to be shared.
DO $$
DECLARE
  t text;
  eim_tables text[] := ARRAY[
    'equipment_assets',
    'asset_status_log',
    'maintenance_tickets',
    'maintenance_notes',
    'ticket_actions',
    'equipment_loans',
    'equipment_loan_items',
    'purchase_requests',
    'purchase_request_items',
    'parts_catalog',
    'parts_inventory',
    'parts_transactions',
    'parts_compatibility',
    'preventive_schedules',
    'sync_tombstones'
  ];
BEGIN
  FOREACH t IN ARRAY eim_tables LOOP
    -- Table may not exist on every deployment; skip missing ones.
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'Skipping % (does not exist)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- Drop the old permissive (public/anon) policy created by the base migration.
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I', t, t);
    -- Recreate scoped to authenticated only.
    EXECUTE format('DROP POLICY IF EXISTS "EIM authenticated full access %s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "EIM authenticated full access %s" ON public.%I '
      || 'FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
    RAISE NOTICE 'Hardened % (authenticated-only)', t;
  END LOOP;
END $$;

-- ── vendors (GATED) ─────────────────────────────────────────────────────────
-- ⚠️ Enable this block ONLY after you have confirmed `vendors` is NOT used by
-- the rental app(s). If it IS shared, leave this commented out — the other apps
-- rely on anon access to it, and tightening it would break them.
--
-- DO $$
-- BEGIN
--   IF to_regclass('public.vendors') IS NOT NULL THEN
--     ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
--     DROP POLICY IF EXISTS "Allow all for vendors" ON public.vendors;
--     DROP POLICY IF EXISTS "EIM authenticated full access vendors" ON public.vendors;
--     CREATE POLICY "EIM authenticated full access vendors" ON public.vendors
--       FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   END IF;
-- END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — restores the original permissive (public/anon) policies.
-- Run this if the EIM app cannot authenticate and you need to restore service
-- quickly. Paste and run ONLY the block below.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DO $$
-- DECLARE
--   t text;
--   eim_tables text[] := ARRAY[
--     'equipment_assets','asset_status_log','maintenance_tickets','maintenance_notes',
--     'ticket_actions','equipment_loans','equipment_loan_items','purchase_requests',
--     'purchase_request_items','parts_catalog','parts_inventory','parts_transactions',
--     'parts_compatibility','preventive_schedules','sync_tombstones','vendors'
--   ];
-- BEGIN
--   FOREACH t IN ARRAY eim_tables LOOP
--     IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
--     EXECUTE format('DROP POLICY IF EXISTS "EIM authenticated full access %s" ON public.%I', t, t);
--     EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I', t, t);
--     EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t, t);
--   END LOOP;
-- END $$;
