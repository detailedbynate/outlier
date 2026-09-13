import type { DatabaseClient } from "@/lib/database/client";
import { unwrap } from "@/lib/database/errors";

export class SystemRepository {
  constructor(private readonly db: DatabaseClient) {}

  async databaseSizeBytes(): Promise<number> {
    return Number(unwrap(await this.db.rpc("database_size_bytes"), "system.databaseSizeBytes"));
  }

  async pruneSnapshots(dailyDays: number, maxDays: number): Promise<{ channelSnapshots: number; videoSnapshots: number }> {
    const rows = unwrap(
      await this.db.rpc("prune_snapshots", { daily_days: dailyDays, max_days: maxDays }),
      "system.pruneSnapshots",
    );
    const row = rows[0];
    return {
      channelSnapshots: Number(row?.channel_snapshots_deleted ?? 0),
      videoSnapshots: Number(row?.video_snapshots_deleted ?? 0),
    };
  }
}
