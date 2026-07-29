BEGIN;

-- This owner-only flag lets the application offer a voluntary username change
-- without exposing or copying the Auth email into the public schema.
ALTER TABLE public.profile_private
  ADD COLUMN IF NOT EXISTS username_privacy_review_needed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

-- Mark exact, case-insensitive matches for a future consent-based prompt. This
-- does not change usernames and never copies an email outside auth.users.
UPDATE public.profile_private private_profile
SET username_privacy_review_needed = true
FROM public.profiles public_profile
JOIN auth.users auth_user ON auth_user.id = public_profile.user_id
WHERE private_profile.user_id = public_profile.user_id
  AND auth_user.email IS NOT NULL
  AND lower(public_profile.username) = lower(split_part(auth_user.email, '@', 1))
  AND NOT private_profile.username_privacy_review_needed;

COMMENT ON COLUMN public.profile_private.username_privacy_review_needed IS
  'Owner-only hint to offer a voluntary username change when a historical username matches the Auth email local part.';

COMMIT;
