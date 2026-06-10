-- Admin marketplace policies call public.has_role(...) while evaluating RLS.
-- Authenticated users must be allowed to execute the SECURITY DEFINER helper;
-- the function still only returns whether the current user has the requested role.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
