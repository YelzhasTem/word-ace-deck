-- Publishing updates owned decks/collections. PostgreSQL may evaluate every
-- permissive UPDATE policy, including admin-only moderation policies. Avoid
-- calling public.has_role(...) there so normal owner updates cannot fail with
-- "permission denied for function has_role".

DROP POLICY IF EXISTS "Admins hide reported decks" ON public.decks;
CREATE POLICY "Admins hide reported decks"
  ON public.decks FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins hide reported collections" ON public.collections;
CREATE POLICY "Admins hide reported collections"
  ON public.collections FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );
