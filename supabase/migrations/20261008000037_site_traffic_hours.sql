-- Traffic, part three:
--
-- * Visits from a creator's or friend's link that arrive with no referrer
--   (Discord, iMessage and most apps send none) say which link they came in
--   on ("SKTL link", "Referral link") instead of Direct. lib/analytics/site.ts
--   does this for new page views; this fills in the ones recorded before.
-- * site_traffic also returns page views by UTC day of week and hour, for the
--   activity heatmap and the 24-hour chart on Admin -> Traffic.

update public.site_events
set source = coalesce(source, case when creator_code is not null then upper(creator_code) || ' link' when ref_code is not null then 'Referral link' end),
    channel = coalesce(channel, case when creator_code is not null then 'Creator codes' when ref_code is not null then 'Referral links' end)
where kind = 'pageview'
  and (creator_code is not null or ref_code is not null)
  and (source is null or channel is null);

create or replace function public.site_traffic(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
as $$
  with e as (
    select * from public.site_events where occurred_at >= p_since and occurred_at < p_until
  ),
  views as (select * from e where kind = 'pageview'),
  -- A page view starts a new visit after 30 minutes of nothing from that visitor.
  -- Engagement pings never start one (someone reading for 40 minutes is one visit).
  activity as (
    select visitor, kind, path, occurred_at, channel, source, engaged_ms, scroll_pct,
           case when kind = 'pageview'
                 and (lag(occurred_at) over w is null or occurred_at - lag(occurred_at) over w >= interval '30 minutes')
                then 1 else 0 end as starts
    from e
    where visitor is not null and kind in ('pageview', 'engagement')
    window w as (partition by visitor order by occurred_at, kind desc)
  ),
  numbered as (
    select *, sum(starts) over (partition by visitor order by occurred_at, kind desc rows unbounded preceding) as visit_no
    from activity
  ),
  visits as (
    select visitor, visit_no,
           count(*) filter (where kind = 'pageview') as pageviews,
           coalesce(sum(engaged_ms), 0) as engaged_ms,
           (array_agg(path order by occurred_at, kind desc) filter (where kind = 'pageview'))[1] as entry_page,
           coalesce((array_agg(channel order by occurred_at, kind desc) filter (where kind = 'pageview'))[1], 'Direct') as channel,
           coalesce((array_agg(source order by occurred_at, kind desc) filter (where kind = 'pageview'))[1], 'Direct') as source
    from numbered
    where visit_no > 0
    group by visitor, visit_no
  ),
  page_reads as (
    select path, visitor, visit_no, sum(engaged_ms) as ms, max(scroll_pct) as scroll
    from numbered
    where kind = 'engagement' and visit_no > 0
    group by 1, 2, 3
  ),
  -- Each checkout and payment, credited to the last visit that came from somewhere.
  conversions as (
    select c.kind, c.visitor, c.amount_cents,
           case when c.visitor is null then 'Not linked' else coalesce(t.channel, 'Direct') end as channel,
           case when c.visitor is null then 'Not linked' else coalesce(t.source, 'Direct') end as source
    from e c
    left join lateral (
      select p.channel, p.source
      from public.site_events p
      where p.visitor = c.visitor and p.kind = 'pageview' and p.channel is not null
        and p.occurred_at <= c.occurred_at and p.occurred_at > c.occurred_at - interval '90 days'
      order by p.occurred_at desc
      limit 1
    ) t on c.visitor is not null
    where c.kind in ('checkout_start', 'subscribed', 'purchase')
  ),
  visit_dims as (
    select 'channel' as dim, channel as name, visitor, pageviews from visits
    union all
    select 'platform', source, visitor, pageviews from visits
  ),
  conversion_dims as (
    select 'channel' as dim, channel as name, kind, visitor, amount_cents from conversions
    union all
    select 'platform', source, kind, visitor, amount_cents from conversions
  ),
  breakdown as (
    select coalesce(v.dim, c.dim) as dim,
           coalesce(v.name, c.name) as name,
           coalesce(v.visits, 0) as visits,
           coalesce(v.visitors, 0) as visitors,
           v.bounce_rate,
           coalesce(c.checkouts, 0) as checkouts,
           coalesce(c.paid, 0) as paid,
           coalesce(c.revenue, 0) as revenue
    from (
      select dim, name, count(*) as visits, count(distinct visitor) as visitors,
             round(100.0 * count(*) filter (where pageviews = 1) / count(*), 1) as bounce_rate
      from visit_dims group by 1, 2
    ) v
    full join (
      select dim, name,
             count(distinct visitor) filter (where kind = 'checkout_start')
               + count(*) filter (where kind = 'checkout_start' and visitor is null) as checkouts,
             count(*) filter (where kind in ('subscribed', 'purchase')) as paid,
             coalesce(sum(amount_cents) filter (where kind in ('subscribed', 'purchase')), 0) as revenue
      from conversion_dims group by 1, 2
    ) c on c.dim = v.dim and c.name = v.name
  )
  select jsonb_build_object(
    'visitors', (select count(distinct visitor) from views),
    'publicVisitors', (select count(distinct visitor) from views where not signed_in),
    'newVisitors', (
      select count(distinct v.visitor) from views v
      where v.visitor is not null
        and not exists (select 1 from public.site_events o where o.visitor = v.visitor and o.occurred_at < p_since)
    ),
    'visits', (select count(*) from visits),
    'bounceRate', (select round(100.0 * count(*) filter (where pageviews = 1) / nullif(count(*), 0), 1) from visits),
    'avgVisitSeconds', (select coalesce(round(avg(engaged_ms) / 1000.0), 0) from visits),
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
      select jsonb_agg(jsonb_build_object('path', p.path, 'views', p.views, 'visitors', p.visitors, 'avgSeconds', r.seconds, 'scroll', r.scroll) order by p.views desc)
      from (select path, count(*) as views, count(distinct visitor) as visitors from views group by path order by 2 desc limit 15) p
      left join (
        select path, round(avg(ms) / 1000.0) as seconds, round(avg(scroll)) as scroll from page_reads group by path
      ) r on r.path = p.path
    ), '[]'::jsonb),
    'entryPages', coalesce((
      select jsonb_agg(jsonb_build_object('path', entry_page, 'visits', visits, 'bounceRate', bounce_rate) order by visits desc)
      from (
        select entry_page, count(*) as visits, round(100.0 * count(*) filter (where pageviews = 1) / count(*), 1) as bounce_rate
        from visits group by 1 order by 2 desc limit 10
      ) en
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'visits', visits, 'visitors', visitors, 'bounceRate', bounce_rate, 'checkouts', checkouts, 'paid', paid, 'revenueCents', revenue) order by visits desc, paid desc)
      from (select * from breakdown where dim = 'channel' order by visits desc, paid desc limit 20) ch
    ), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'visits', visits, 'visitors', visitors, 'bounceRate', bounce_rate, 'checkouts', checkouts, 'paid', paid, 'revenueCents', revenue) order by visits desc, paid desc)
      from (select * from breakdown where dim = 'platform' order by visits desc, paid desc limit 20) pl
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'visitors', visitors, 'checkouts', checkouts) order by visitors desc)
      from (
        select coalesce('utm ' || utm_source || coalesce(' / ' || utm_campaign, ''), 'code ' || upper(creator_code), 'referral link') as name,
               count(distinct visitor) filter (where kind = 'pageview') as visitors,
               count(distinct visitor) filter (where kind = 'checkout_start') as checkouts
        from e where utm_source is not null or creator_code is not null or ref_code is not null
        group by 1 order by 2 desc limit 10
      ) s
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hour, 'visitors', visitors, 'pageviews', pageviews) order by dow, hour)
      from (
        select extract(dow from occurred_at at time zone 'UTC')::int as dow,
               extract(hour from occurred_at at time zone 'UTC')::int as hour,
               count(distinct visitor) as visitors,
               count(*) as pageviews
        from views group by 1, 2
      ) h
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_object_agg(coalesce(device, 'unknown'), visitors)
      from (select device, count(distinct visitor) as visitors from views group by 1) dv
    ), '{}'::jsonb)
  );
$$;

revoke execute on function public.site_traffic(timestamptz, timestamptz) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.site_traffic(timestamptz, timestamptz) to service_role;
  end if;
end $$;
