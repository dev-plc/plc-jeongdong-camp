-- ─────────────────────────────────────────────────────────────────────
-- 명단 사본 (D-055) — Supabase SQL Editor 에서 **한 번** 실행합니다. 여러 번 실행해도 됩니다.
--
-- 캠프 모드 동안만, 그 회차 인원만(참여 일자 공란 제외), 연락처 없이 올라갑니다.
-- 🔴 표는 **아무도 직접 못 읽습니다** (RLS 켬 · 정책 없음 · anon GRANT 없음).
--    앱은 아래 함수 둘로만 꺼냅니다 — 이름+뒷4자리(해시)가 맞거나, 발급받은 토큰이 있을 때만.
-- 🔴 30분 넘게 갱신이 없는 행은 함수가 무시합니다. 캠프 모드는 10분마다 갱신하므로,
--    동기화가 멈추면 앱은 저절로 GAS(느리지만 원장)로 돌아갑니다.
--
-- 테스트(tests/db/people.test.js)가 **이 파일을 그대로** 로컬 Postgres 에 적용해 검증합니다.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists people_cache (
  pid         text primary key,          -- 참가자ID
  session     text not null,             -- 참여 일자(회차 라벨)
  me          jsonb not null,            -- GAS `me` 응답과 같은 모양 (연락처 없음, D-003)
  keys        text[] not null default '{}',  -- SHA-256(정규화 이름|4자리) hex. 두 사람이 겹치는 키는 GAS 가 뺀다
  token       text not null,             -- 오늘 토큰 (서울 모레 0시 만료)
  token_prev  text not null,             -- 어제 토큰 (서울 내일 0시 만료) — 날이 바뀌어도 앱이 안 끊긴다
  updated_at  timestamptz not null default now()
);

alter table people_cache enable row level security;
-- 정책을 만들지 않습니다 = anon·authenticated 는 행을 하나도 못 봅니다.

-- 🔴 표 권한: 쓰기(GAS)만. anon 에는 **주지 않습니다.**
revoke all on people_cache from anon, authenticated;
grant usage on schema public to service_role;
grant all    on people_cache to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 로그인: 키가 **정확히 한 사람**에게만 맞을 때 {token, me}. 아니면 null → 앱이 GAS 로 간다.
create or replace function camp_login(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with hit as (
    select token, me
      from people_cache
     where length(p_key) = 64
       and p_key = any (keys)
       and updated_at > now() - interval '30 minutes'
  )
  select case when (select count(*) from hit) = 1
              then (select jsonb_build_object('token', token, 'me', me) from hit)
         end;
$$;

-- 내 정보: 오늘·어제 토큰 중 하나가 **정확히** 같을 때. 토큰은 HMAC 서명이라 추측할 수 없다.
create or replace function camp_me(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select me
    from people_cache
   where length(p_token) > 20
     and (token = p_token or token_prev = p_token)
     and updated_at > now() - interval '30 minutes'
   limit 1;
$$;

-- 함수는 기본으로 PUBLIC 이 실행할 수 있다 — 거두고 anon 에만 준다.
revoke all on function camp_login(text) from public;
revoke all on function camp_me(text)    from public;
grant usage on schema public to anon;
grant execute on function camp_login(text) to anon;
grant execute on function camp_me(text)    to anon;
