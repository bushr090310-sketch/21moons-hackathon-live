-- Private evidence bucket (Supabase only). Evidence is never public.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 8388608,
            array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Default challenge set (26 September 2026, Europe/Stockholm).
-- Seeded once; everything is editable from /admin afterwards.
-- ---------------------------------------------------------------------------
insert into challenges
  (slug, emoji, title, points, challenge_type, award_mode, status, reveal_at, expires_at,
   is_secret, max_completions_per_team, accepts_submissions, sort_order,
   short_description, full_description, evidence_config, metadata)
values
-- GROUND CHALLENGES — 09:00
('speedrun', '⚡', 'Speedrun', 15, 'FIRST_GLOBAL', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 10,
  'First team with a genuinely usable public product and a working signup/payment/customer flow.',
  'The first team to ship a genuinely usable, publicly accessible product with a working signup, payment or customer flow wins. Organizers will test it — it has to actually work.',
  '{"requireUrl": true, "allowFiles": true, "hint": "Link to the live product and describe the flow we should test."}', '{}'),
('first-sale', '💰', 'First Sale', 25, 'FIRST_GLOBAL', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 20,
  'First team to get a real paying customer.',
  'First team to get a real, paying customer. Payment must be genuine. Refunded, fake or internal transactions (team members, friends paying back, organizers) do not count.',
  '{"requireUrl": false, "allowFiles": true, "hint": "A screenshot of the payment is enough. Blur customer names, emails and card details — we only need to see that it is real."}', '{"sensitive": true}'),
('ship-before-lunch', '🚢', 'Ship Before Lunch', 20, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', '2026-09-26 13:00 Europe/Stockholm', false, 1, true, 30,
  'Have a functioning, publicly accessible MVP before 13:00.',
  'Get a functioning MVP live on a public URL before 13:00. Submissions close at 13:00 sharp.',
  '{"requireUrl": true, "allowFiles": false, "hint": "Public URL of your MVP."}', '{}'),
('talk-to-25-strangers', '🗣', 'Talk to 25 Strangers', 15, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 40,
  'Show or demo the product to at least 25 people outside the team and document it.',
  'Show or demo your product to at least 25 people outside your team (and outside other hackathon teams) and document it — photos, a list, notes, a short video link.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "People talked to", "hint": "Photos, a list or notes documenting the conversations."}', '{}'),
('irl-customer', '🚶', 'IRL Customer', 20, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 50,
  'Get a random person outside the team to genuinely test the product in real life.',
  'Walk up to a random person outside the team and get them to genuinely test your product in real life.',
  '{"requireUrl": false, "allowFiles": true, "hint": "A photo of the test (with their permission) or a short description."}', '{}'),
('real-user-review', '⭐', 'Real User Review', 10, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 60,
  'Get a genuine user or customer to provide a testimonial or review.',
  'Get a genuine user or customer to give you a testimonial or review. Must be real and unprompted by the team writing it for them.',
  '{"requireUrl": false, "allowFiles": true, "hint": "Screenshot or link to the review."}', '{}'),
('stranger-posts-it', '📣', 'Stranger Posts It', 20, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 70,
  'Get someone outside the team to voluntarily post or share the product on their own social account.',
  'Get someone outside the team to voluntarily post or share your product on their own social account.',
  '{"requireUrl": true, "allowFiles": true, "hint": "Link to the post."}', '{}'),
('users-come-back', '🔁', 'Users Come Back', 25, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, true, 80,
  'Get at least 10 real users to use the product on two separate occasions.',
  'Get at least 10 real users to use your product on two separate occasions or interactions. Show analytics or logs.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "Returning users", "hint": "Analytics screenshot or anonymised logs."}', '{}'),

-- 11:00 DROP
('first-blood', '🩸', 'First Blood', 20, 'FIRST_GLOBAL', 'on_approval', 'scheduled',
  '2026-09-26 11:00 Europe/Stockholm', null, false, 1, true, 100,
  'First team after this drop to get a NEW stranger to genuinely use their product.',
  'First team after this challenge was revealed to get a brand-new stranger to genuinely use their product. Users acquired before the reveal do not count.',
  '{"requireUrl": false, "allowFiles": true, "hint": "Show the timestamp of the new user (after the reveal)."}', '{}'),
('100-users', '💯', '100 Users', 30, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 11:00 Europe/Stockholm', null, false, 1, true, 110,
  'Reach 100 genuine users or signups during the hackathon.',
  'Reach 100 genuine users or signups during the hackathon. Bots, team members and duplicate accounts do not count.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "Users / signups", "numericRequired": true, "hint": "Analytics or database screenshot."}', '{}'),

-- 13:00–14:00 EVENT
('revenue-rush', '🔥', 'Revenue Rush', 15, 'REPEATABLE', 'on_approval', 'scheduled',
  '2026-09-26 13:00 Europe/Stockholm', '2026-09-26 14:00 Europe/Stockholm', false, 2, true, 200,
  '15 points per verified new paying customer between 13:00 and 14:00. Max 2 awards per team.',
  '15 points per verified NEW paying customer. Only transactions completed between 13:00 and 14:00 count. Maximum 2 awards (30 points) per team. Submit one application per customer.',
  '{"requireUrl": false, "allowFiles": true, "hint": "Payment screenshot showing the time. Blur private customer details."}', '{"sensitive": true}'),

-- 14:00 DROP
('crazy-experiment', '🧪', 'Crazy Experiment', 15, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 14:00 Europe/Stockholm', null, false, 1, true, 300,
  'Run a creative, legal and safe growth experiment that tests an unconventional idea.',
  'Run a creative, legal and safe growth or user-acquisition experiment that genuinely tests an unconventional idea. Organizers verify quality.',
  '{"requireUrl": false, "allowFiles": true, "hint": "What did you try, and what happened?"}', '{}'),

-- 15:00 DROP
('content-war', '🎬', 'Content War', 30, 'COMPETITIVE', 'on_finalize', 'scheduled',
  '2026-09-26 15:00 Europe/Stockholm', '2026-09-26 15:45 Europe/Stockholm', false, 1, true, 400,
  '45 minutes to create and publish a video or content piece about your product. Best performance wins.',
  'You have 45 minutes to create and publish a video/content piece about your product. Submission deadline 15:45. The winner is decided by verified performance measured at 18:00.',
  '{"requireUrl": true, "allowFiles": false, "numericLabel": "Views so far", "hint": "Link to the published content."}', '{"measurementDeadline": "2026-09-26T16:00:00Z"}'),
('go-viral', '🚀', 'Go Viral', 35, 'OPEN_ONCE', 'on_approval', 'scheduled',
  '2026-09-26 15:00 Europe/Stockholm', null, false, 1, true, 410,
  'Get one hackathon-created piece of content to 10,000+ verified views during the event.',
  'Get one piece of content created during the hackathon to 10,000+ verified views during the event.',
  '{"requireUrl": true, "allowFiles": true, "numericLabel": "Views", "numericRequired": true, "hint": "Link plus a screenshot of the view count."}', '{}'),

-- FINAL / COMPETITIVE
('most-revenue', '💸', 'Most Revenue', 40, 'COMPETITIVE', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', '2026-09-26 18:00 Europe/Stockholm', false, 1, true, 500,
  'Most verified real revenue during the hackathon.',
  'Most verified real revenue during the hackathon. Submit your total (SEK) with evidence; you can resubmit updated totals. Blur private customer details.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "Total revenue (SEK)", "numericRequired": true}', '{"sensitive": true, "rankBy": "desc"}'),
('most-customers', '👥', 'Most Customers', 30, 'COMPETITIVE', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', '2026-09-26 18:00 Europe/Stockholm', false, 1, true, 510,
  'Most unique verified paying customers.',
  'Most unique verified paying customers during the hackathon. Resubmit as your number grows.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "Paying customers", "numericRequired": true}', '{"sensitive": true, "rankBy": "desc"}'),
('most-users', '👤', 'Most Users', 30, 'COMPETITIVE', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', '2026-09-26 18:00 Europe/Stockholm', false, 1, true, 520,
  'Most genuine verified users or signups.',
  'Most genuine verified users or signups during the hackathon. Resubmit as your number grows.',
  '{"requireUrl": false, "allowFiles": true, "numericLabel": "Users / signups", "numericRequired": true}', '{"rankBy": "desc"}'),
('most-social-views', '📱', 'Most Social Views', 25, 'COMPETITIVE', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', '2026-09-26 18:00 Europe/Stockholm', false, 1, true, 530,
  'Most verified social views from content created during the hackathon.',
  'Most verified social views from content created during the hackathon.',
  '{"requireUrl": true, "allowFiles": true, "numericLabel": "Total views", "numericRequired": true}', '{"rankBy": "desc"}'),
('best-product', '🧠', 'Best Product', 40, 'JUDGED', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 600,
  'The jury picks the best product: usefulness, quality, UX and overall value.',
  'The jury evaluates usefulness, product quality, UX and overall value.', '{}', '{}'),
('best-pitch', '🎤', 'Best Pitch', 30, 'JUDGED', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 610,
  'Best final presentation / pitch.', 'Best final presentation / pitch, decided by the jury.', '{}', '{}'),
('best-landing-page', '🎨', 'Best Landing Page', 15, 'JUDGED', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 620,
  'Best landing page, decided by the jury.', 'Best landing page, decided by the jury.', '{}', '{}'),
('content-king', '👑', 'Content King', 20, 'JUDGED', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 630,
  'Best overall product / hackathon content.', 'Best overall product and hackathon content, decided by the jury.', '{}', '{}'),
('funniest-marketing', '😂', 'Funniest Marketing', 15, 'JUDGED', 'on_finalize', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 640,
  'Best funny / creative organic marketing execution.', 'Best funny or creative organic marketing execution, decided by the jury.', '{}', '{}'),
('peoples-choice', '🏆', 'People''s Choice', 25, 'VOTE', 'on_vote', 'scheduled',
  '2026-09-26 09:00 Europe/Stockholm', null, false, 1, false, 700,
  'Every participant votes for their favourite team. You cannot vote for your own team.',
  'Every participant gets one personal voting code and one vote. You cannot vote for your own team. Voting opens at the end of the day.', '{}', '{}'),
('secret-challenge', '🎯', 'Secret Challenge', 30, 'OPEN_ONCE', 'on_approval', 'draft',
  null, null, true, 1, true, 900,
  '', '', '{"requireUrl": false, "allowFiles": true}', '{"adminNote": "Configure the real content, then Activate now or schedule it."}')
on conflict (slug) do nothing;
