-- §9: "17 built-in exercises to start" (gym_id null = built-in, shared by all gyms).
-- The same 17 exercises the mobile app's demo uses. Reference data only:
-- inserts rows, never updates or deletes, and skips any that already exist.

INSERT INTO exercises (id, gym_id, name, equipment, muscle) VALUES
  ('squat',        NULL, 'Back squat',              'bar',     'legs'),
  ('bench',        NULL, 'Bench press',             'bar',     'chest'),
  ('deadlift',     NULL, 'Deadlift',                'bar',     'back'),
  ('ohp',          NULL, 'Overhead press',          'bar',     'shoulders'),
  ('row',          NULL, 'Barbell row',             'bar',     'back'),
  ('incline-db',   NULL, 'Incline dumbbell press',  'db',      'chest'),
  ('db-curl',      NULL, 'Dumbbell curl',           'db',      'arms'),
  ('db-shoulder',  NULL, 'Dumbbell shoulder press', 'db',      'shoulders'),
  ('lat-pulldown', NULL, 'Lat pulldown',            'machine', 'back'),
  ('leg-press',    NULL, 'Leg press',               'machine', 'legs'),
  ('leg-curl',     NULL, 'Leg curl',                'machine', 'legs'),
  ('chest-press',  NULL, 'Chest press machine',     'machine', 'chest'),
  ('pushdown',     NULL, 'Triceps pushdown',        'machine', 'arms'),
  ('pull-up',      NULL, 'Pull-up',                 'body',    'back'),
  ('push-up',      NULL, 'Push-up',                 'body',    'chest'),
  ('dip',          NULL, 'Dip',                     'body',    'arms'),
  ('crunch',       NULL, 'Crunch',                  'body',    'core')
ON CONFLICT (id) DO NOTHING;
