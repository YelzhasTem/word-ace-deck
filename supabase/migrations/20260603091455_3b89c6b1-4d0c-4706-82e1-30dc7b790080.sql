CREATE POLICY "No client inserts on user_roles" ON public.user_roles FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "No client updates on user_roles" ON public.user_roles FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes on user_roles" ON public.user_roles FOR DELETE TO authenticated, anon USING (false);