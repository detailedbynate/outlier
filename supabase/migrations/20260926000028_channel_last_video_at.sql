-- When a channel last published, kept on the channel row.
--
-- The scraper walks channels by how long ago they were synced, which treats a
-- channel posting twice a day the same as one that stopped in 2023. Both get
-- read every six days, so new uploads can sit unseen for most of a week while
-- the scraper spends its reads on dormant channels. Deriving "still active"
-- from max(videos.published_at) at query time is too slow to sort 7,000
-- channels by, so it lives here and a trigger keeps it true.

alter table public.channels add column if not exists last_video_at timestamptz;

comment on column public.channels.last_video_at is
  'Newest published_at among this channel''s stored videos. Maintained by trigger; used to refresh active channels more often.';

update public.channels c
set last_video_at = v.newest
from (select channel_id, max(published_at) as newest from public.videos group by channel_id) v
where v.channel_id = c.id and c.last_video_at is distinct from v.newest;

-- Sorting the due-for-refresh queue reads this with tracked and last_synced_at.
create index if not exists channels_last_video_at_idx
  on public.channels (last_video_at desc nulls last);

create or replace function public.channels_touch_last_video_at() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.channels
     set last_video_at = new.published_at
   where id = new.channel_id
     and (last_video_at is null or last_video_at < new.published_at);
  return new;
end;
$$;

drop trigger if exists videos_touch_channel_last_video_at on public.videos;

create trigger videos_touch_channel_last_video_at
  after insert or update of published_at on public.videos
  for each row
  execute function public.channels_touch_last_video_at();
