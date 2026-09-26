insert into public.hackathons (slug, name, starts_on, ends_on, location, status)
values ('hackathon-winners-ultimate-malmo-2026',
        'Hackathon Winners'' Ultimate Hackathon',
        '2026-09-26', '2026-09-26', 'Malmö', 'active')
on conflict (slug) do nothing;
