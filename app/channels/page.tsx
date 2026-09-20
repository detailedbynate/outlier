/* eslint-disable @next/next/no-img-element -- YouTube avatars are already CDN-optimized */
import { BookmarkIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { TrackChannelForm } from "@/components/track-channel-form";
import { formatCompact, formatNumber, timeAgo } from "@/lib/format";
import { requireApprovedUser } from "@/lib/auth/session";
import { getServices } from "@/lib/services";
import { setChannelTracked } from "../research/shorts-channels/actions";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const current = await requireApprovedUser();
  const channels = await getServices().repositories.channels.listFollowed(current.user.id, { limit: 200 });

  return (
    <div className="stack">
      <PageHeader icon={BookmarkIcon} title="Tracked Channels" subtitle="The channels you track, refreshed every day. Only you can see this list." />

      <section className="card">
        <h2>Track a channel</h2>
        <TrackChannelForm />
      </section>

      <section className="card">
        {channels.length === 0 ? (
          <div className="empty">No channels yet. Track one above.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="num">Subscribers</th>
                  <th className="num">Total views</th>
                  <th className="num">Videos</th>
                  <th className="num">Last synced</th>
                  <th className="num">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={channel.id}>
                    <td>
                      <Link href={`/channels/${channel.youtube_channel_id}`} className="row" style={{ gap: 10 }}>
                        {channel.thumbnail_url ? <img className="avatar" src={channel.thumbnail_url} alt="" loading="lazy" /> : null}
                        <span>
                          <strong>{channel.title}</strong>
                          {channel.handle ? <span className="muted"> {channel.handle}</span> : null}
                        </span>
                      </Link>
                    </td>
                    <td className="num">{channel.hidden_subscriber_count ? "Hidden" : formatCompact(channel.subscriber_count)}</td>
                    <td className="num">{formatCompact(channel.view_count)}</td>
                    <td className="num">{formatNumber(channel.video_count)}</td>
                    <td className="num muted">{timeAgo(channel.last_synced_at)}</td>
                    <td className="num">
                      <form action={setChannelTracked}>
                        <input type="hidden" name="channelId" value={channel.id} />
                        <input type="hidden" name="tracked" value="false" />
                        <button type="submit" className="button-ghost button-small" aria-label={`Remove ${channel.title} from tracked channels`}>
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
