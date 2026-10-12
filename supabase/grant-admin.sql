-- Grant dashboard access.
--
-- This is NOT part of 0001_init.sql. That migration creates the `admins`
-- table empty, because it cannot know your address, so this is the one-off
-- you run yourself, and again for each new staff member.
--
-- Order matters: create the login first, under
--   Authentication, Users, Add user   (tick "Auto Confirm User")
-- then change the address on the marked line below and run the whole file.

do $$
declare
  -- vvv THE ONLY LINE TO EDIT vvv
  admin_email text := 'you@yourdomain.com';
  -- ^^^ THE ONLY LINE TO EDIT ^^^
  target uuid;
begin
  select id into target
    from auth.users
   where lower(email) = lower(admin_email);

  if target is null then
    raise exception
      'No user with address %. Create it under Authentication, Users (tick Auto Confirm User), then run this again.',
      admin_email;
  end if;

  insert into public.admins (user_id, email)
  values (target, admin_email)
      on conflict (user_id) do nothing;

  raise notice 'Granted admin access to % (%)', admin_email, target;
end
$$;

-- Confirm it took.
select email, user_id, created_at from public.admins order by created_at;
