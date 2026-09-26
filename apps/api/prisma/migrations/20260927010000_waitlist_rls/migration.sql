-- RLS pour waitlist_entries : la table est déjà RLS-enabled + FORCED
-- (migration add_rls_itérative postérieure) mais sans AUCUNE policy →
-- fail-closed : le POST /waitlist public était refusé silencieusement.
--
-- Modèle d'accès réel (waitlist.controller.ts / waitlist.service.ts) :
--   - POST /waitlist : PUBLIC, sans contexte user → FOR INSERT all rows
--   - GET admin/waitlist + POST notify : ADMIN/SUPER_ADMIN → SELECT/UPDATE
--     filtrés par le rôle lu dans `users` (table volontairement non-RLS —
--     lookup avant identité ; le sous-select dans la policy est donc légal).

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_entries_insert_public ON waitlist_entries;
DROP POLICY IF EXISTS waitlist_entries_admin_all ON waitlist_entries;

-- Insertion publique : aucun contexte user n'est requis.
CREATE POLICY waitlist_entries_insert_public ON waitlist_entries
  FOR INSERT WITH CHECK (true);

-- Admin-only pour le reste (SELECT/UPDATE/DELETE — INSERT déjà couvert
-- par la policy permissive ci-dessus, l'OR des policies l'autorise à tous).
CREATE POLICY waitlist_entries_admin_all ON waitlist_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.current_user_id', true)
        AND u.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = current_setting('app.current_user_id', true)
        AND u.role IN ('ADMIN', 'SUPER_ADMIN')
    )
  );
