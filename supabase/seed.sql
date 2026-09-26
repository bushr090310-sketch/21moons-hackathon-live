-- Run once in production (SQL editor), after the migration.

-- 1. Today's hackathon — as data, never hardcoded in the app.
insert into public.hackathons (slug, name, starts_on, ends_on, location, status)
values ('hackathon-winners-ultimate-malmo-2026',
        'Hackathon Winners'' Ultimate Hackathon',
        '2026-09-26', '2026-09-26', 'Malmö', 'active')
on conflict (slug) do nothing;

-- 2. Admins: Yusuf and Liam sign up normally first (confirmed email),
--    then run this with their real emails:
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users
-- where lower(email) in ('yusuf@EXAMPLE', 'liam@EXAMPLE')
-- on conflict (user_id) do update set role = 'admin';
