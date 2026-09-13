import { AppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";

const MB = 1024 * 1024;

export interface StorageStatus {
  usedBytes: number;
  budgetBytes: number;
  planLimitBytes: number;
  /** Share of the budget used, 0-1+. */
  budgetUsed: number;
  /** Share of the plan limit used, 0-1+. */
  planUsed: number;
  level: "ok" | "warning" | "over_budget";
}

export interface StorageBudgetConfig {
  budgetMb: number;
  planLimitMb: number;
  /** Start warning at this share of the budget. */
  warnAt?: number;
}

/**
 * Keeps the database well under the Supabase plan limit. Ingestion checks
 * `assertCapacity()` before writing; once the budget is reached, new syncs stop
 * (reads keep working) until data is pruned or the budget is raised.
 */
export class StorageBudgetService {
  private readonly log: Logger;
  private cached: { status: StorageStatus; at: number } | undefined;

  constructor(
    private readonly measure: () => Promise<number>,
    private readonly config: StorageBudgetConfig,
    logger?: Logger,
    private readonly cacheMs = 60_000,
  ) {
    if (config.budgetMb > config.planLimitMb) {
      throw new AppError("CONFIG_ERROR", "STORAGE_BUDGET_MB must not exceed SUPABASE_PLAN_LIMIT_MB");
    }
    this.log = logger ?? createLogger({ module: "services.storage-budget" });
  }

  async getStatus(options: { fresh?: boolean } = {}): Promise<StorageStatus> {
    if (!options.fresh && this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.status;

    const usedBytes = await this.measure();
    const budgetBytes = this.config.budgetMb * MB;
    const planLimitBytes = this.config.planLimitMb * MB;
    const budgetUsed = usedBytes / budgetBytes;
    const level = budgetUsed >= 1 ? "over_budget" : budgetUsed >= (this.config.warnAt ?? 0.8) ? "warning" : "ok";
    const status: StorageStatus = { usedBytes, budgetBytes, planLimitBytes, budgetUsed, planUsed: usedBytes / planLimitBytes, level };

    if (level !== "ok") this.log.warn("database storage budget", { usedMb: Math.round(usedBytes / MB), budgetMb: this.config.budgetMb, level });
    this.cached = { status, at: Date.now() };
    return status;
  }

  /** Throw STORAGE_BUDGET_EXCEEDED when ingestion should not add more data. */
  async assertCapacity(): Promise<StorageStatus> {
    const status = await this.getStatus();
    if (status.level === "over_budget") {
      throw new AppError(
        "STORAGE_BUDGET_EXCEEDED",
        `Database is at ${Math.round(status.usedBytes / MB)} MB, over the ${this.config.budgetMb} MB storage budget. New syncs are paused.`,
        { details: { usedBytes: status.usedBytes, budgetBytes: status.budgetBytes } },
      );
    }
    return status;
  }
}
