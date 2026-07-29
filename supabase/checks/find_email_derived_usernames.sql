-- Run only in the trusted Supabase SQL Editor or an administrative connection.
-- The comparison reads auth.users internally but never returns an email value.

-- Aggregate audit suitable for routine checks.
SELECT count(*) AS email_derived_username_count
FROM public.profiles public_profile
JOIN auth.users auth_user ON auth_user.id = public_profile.user_id
WHERE auth_user.email IS NOT NULL
  AND lower(public_profile.username) = lower(split_part(auth_user.email, '@', 1));

-- Review queue. username is already public; email and its domain are omitted.
SELECT
  public_profile.user_id,
  public_profile.username,
  COALESCE(private_profile.username_privacy_review_needed, false) AS review_needed
FROM public.profiles public_profile
JOIN auth.users auth_user ON auth_user.id = public_profile.user_id
LEFT JOIN public.profile_private private_profile
  ON private_profile.user_id = public_profile.user_id
WHERE auth_user.email IS NOT NULL
  AND lower(public_profile.username) = lower(split_part(auth_user.email, '@', 1))
ORDER BY public_profile.created_at;
