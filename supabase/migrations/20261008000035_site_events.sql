-- Site traffic, first-party: page views, who scrolled to pricing, checkouts
-- started and paid. No cookies: a visitor is a hash of IP, browser and the
-- day, so the same person counts once a day and can't be followed across days.

create table if not exists public.site_events (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  -- pageview | pricing_view | checkout_start | subscribed | purchase | waitlist_join
  kind          text not null,
  visitor       text,
  signed_in     boolean not null default false,
  path          text,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  creator_code  text,
  ref_code      text,
  device        text,
  -- What it was about: the plan or credit pack, for checkouts and payments.
  detail        text,
  amount_cents  integer,
  -- Stripe can send the same payment twice; it's recorded once.
  dedupe_key    text unique
);

create index if not exists site_events_time_idx on public.site_events (occurred_at);
create index if not exists site_events_kind_time_idx on public.site_events (kind, occurred_at);

alter table public.site_events enable row level security;

-- Everything the traffic page shows for one stretch of time, in one round trip.
create or replace function public.site_traffic(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
as $$
  with e as (
    select * from public.site_events where occurred_at >= p_since and occurred_at < p_until
  ),
  views as (select * from e where kind = 'pageview')
  select jsonb_build_object(
    'visitors', (select count(distinct visitor) from views),
    'publicVisitors', (select count(distinct visitor) from views where not signed_in),
    'pageviews', (select count(*) from views),
    'live', (select count(distinct visitor) from public.site_events where kind = 'pageview' and occurred_at >= now() - interval '30 minutes'),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'visitors', visitors, 'pageviews', pageviews, 'checkouts', checkouts, 'paid', paid) order by day)
      from (
        select date_trunc('day', occurred_at)::date as day,
               count(distinct visitor) filter (where kind = 'pageview') as visitors,
               count(*) filter (where kind = 'pageview') as pageviews,
               count(distinct visitor) filter (where kind = 'checkout_start') as checkouts,
               count(*) filter (where kind in ('subscribed', 'purchase')) as paid
        from e group by 1
      ) d
    ), '[]'::jsonb),
    'funnel', jsonb_build_object(
      'landing', (select count(distinct visitor) from views where path = '/' and not signed_in),
      'pricing', (select count(distinct visitor) from e where kind = 'pricing_view' or (kind = 'pageview' and path = '/billing')),
      'checkout', (select count(distinct visitor) from e where kind = 'checkout_start'),
      'subscribed', (select count(*) from e where kind = 'subscribed'),
      'purchases', (select count(*) from e where kind = 'purchase'),
      'waitlist', (select count(*) from e where kind = 'waitlist_join'),
      'revenueCents', (select coalesce(sum(amount_cents), 0) from e where kind in ('subscribed', 'purchase'))
    ),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visitors', visitors) order by views desc)
      from (select path, count(*) as views, count(distinct visitor) as visitors from views group by path order by 2 desc limit 15) p
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(jsonb_build_object('name', referrer_host, 'visitors', visitors) order by visitors desc)
      from (select referrer_host, count(distinct visitor) as visitors from views where referrer_host is not null group by 1 order by 2 desc limit 10) r
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'visitors', visitors, 'checkouts', checkouts) order by visitors desc)
      from (
        select coalesce(utm_source, 'code ' || upper(creator_code), 'referral link') as name,
               count(distinct visitor) filter (where kind = 'pageview') as visitors,
               count(distinct visitor) filter (where kind = 'checkout_start') as checkouts
        from e where utm_source is not null or creator_code is not null or ref_code is not null
        group by 1 order by 2 desc limit 10
      ) s
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_object_agg(coalesce(device, 'unknown'), visitors)
      from (select device, count(distinct visitor) as visitors from views group by 1) dv
    ), '{}'::jsonb)
  );
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.site_events to service_role;
    grant execute on function public.site_traffic(timestamptz, timestamptz) to service_role;
  end if;
end $$;
revoke execute on function public.site_traffic(timestamptz, timestamptz) from public, anon, authenticated;
