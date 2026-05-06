-- ══════════════════════════════════════════
-- PROJECT SOLOMON · Supabase Setup SQL
-- Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════

-- 1. Students table
create table if not exists students (
  email       text primary key,
  name        text not null default '',
  section     text not null default '',
  avatar      text not null default '',
  status      text not null default 'pending',
  xp          integer not null default 0,
  loot_bags   integer not null default 0,
  created_at  timestamptz not null default now()
);

-- 2. Quizzes table
create table if not exists quizzes (
  id          text primary key,
  title       text not null default '',
  subject     text not null default '',
  time        integer not null default 15,
  sections    text not null default '',
  locked      boolean not null default false,
  category    text not null default 'practice',
  created_at  timestamptz not null default now()
);

-- 3. Quiz questions (stores JSON blob per quiz)
create table if not exists quiz_questions (
  quiz_id     text primary key references quizzes(id) on delete cascade,
  questions   text not null default '[]'
);

-- 4. Scores table
create table if not exists scores (
  id           bigint generated always as identity primary key,
  email        text not null,
  name         text not null default '',
  section      text not null default '',
  quiz_id      text not null,
  quiz_title   text not null default '',
  category     text not null default 'practice',
  score        integer not null default 0,
  total        integer not null default 0,
  percent      integer not null default 0,
  xp           integer not null default 0,
  tab_switches integer not null default 0,
  time_taken   text not null default '',
  created_at   timestamptz not null default now()
);

-- 5. Lesson data table (stores adventure lesson JSON)
create table if not exists lesson_data (
  quiz_id        text primary key,
  lesson_content text not null default '',
  saved_at       timestamptz not null default now()
);

-- ── Optional: useful indexes ──
create index if not exists scores_email_idx on scores(email);
create index if not exists scores_quiz_id_idx on scores(quiz_id);
create index if not exists quizzes_locked_idx on quizzes(locked);

-- ══ Done! Tables are ready. ══
