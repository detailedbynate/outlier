import type { TextProvider } from "@/lib/ai/types";
import { isAppError } from "@/lib/core/errors";
import { createLogger, type Logger } from "@/lib/core/logger";
import type { ChannelRepository } from "@/lib/database/repositories/channels";
import type { NicheRepository } from "@/lib/database/repositories/niches";
import {
  buildLabelPrompt,
  LABEL_SYSTEM_PROMPT,
  labelBatchSchema,
  nicheSlug,
  normalizeLabel,
  type ChannelLabelInput,
} from "@/lib/niches/labeling";
import { CONFIDENT, labelWithRules, RULES_MODEL, type RuleLabel } from "@/lib/niches/rule-labeler";

export interface LabelRunResult {
  labeled: number;
  /** Of those, how many the AI provider labeled. */
  byAi: number;
  /** Labeled with a category but no clear game or topic. */
  categoryOnly: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
}

export interface NicheLabelingConfig {
  batchSize: number;
}

type PendingChannel = Awaited<ReturnType<ChannelRepository["listUnlabeled"]>>[number];

/**
 * Labels channels that were never labeled. Rules label every channel for free;
 * when an AI provider is configured, only the channels the rules weren't sure
 * about are sent to it, in batches. If the AI call fails, the rule label stands.
 */
export class NicheLabelingService {
  private readonly log: Logger;

  constructor(
    private readonly deps: {
      text: TextProvider | null;
      channels: Pick<ChannelRepository, "listUnlabeled" | "saveNicheLabel">;
      niches: Pick<NicheRepository, "upsertEntity" | "refreshChannelCounts">;
    },
    private readonly config: NicheLabelingConfig,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ module: "services.niche_labeling" });
  }

  async labelPending(options: { maxChannels: number; signal?: AbortSignal; now?: () => Date }): Promise<LabelRunResult> {
    const result: LabelRunResult = { labeled: 0, byAi: 0, categoryOnly: 0, batches: 0, inputTokens: 0, outputTokens: 0 };
    const now = options.now ?? (() => new Date());

    const pending = await this.deps.channels.listUnlabeled(options.maxChannels);
    const ruled = pending.map((channel) => ({
      channel,
      label: labelWithRules({
        title: channel.title,
        description: channel.description,
        keywords: channel.keywords,
        topicCategories: channel.topic_categories,
        uploads: channel.uploads,
      }),
    }));

    const unsure = this.deps.text ? ruled.filter((r) => r.label.confidence < CONFIDENT) : [];
    const aiLabels = unsure.length > 0 ? await this.labelWithAi(unsure.map((r) => r.channel), result, options.signal) : new Map<string, { label: RuleLabel; model: string }>();

    // Most channels share a handful of games and categories: look each entity up once per run.
    const entityIds = new Map<string, Promise<string>>();
    for (const { channel, label } of ruled) {
      if (options.signal?.aborted) break;
      const ai = aiLabels.get(channel.id);
      await this.save(channel.id, ai?.label ?? label, ai?.model ?? RULES_MODEL, now(), entityIds);
      result.labeled += 1;
      if (ai) result.byAi += 1;
      if (!(ai?.label ?? label).primary) result.categoryOnly += 1;
    }

    if (result.labeled > 0) await this.deps.niches.refreshChannelCounts();
    this.log.info("niche labeling run", { ...result });
    return result;
  }

  /** Second opinion for unsure channels. Failures just leave the rule labels in place. */
  private async labelWithAi(channels: PendingChannel[], result: LabelRunResult, signal?: AbortSignal): Promise<Map<string, { label: RuleLabel; model: string }>> {
    const labels = new Map<string, { label: RuleLabel; model: string }>();
    for (let i = 0; i < channels.length && !signal?.aborted; i += this.config.batchSize) {
      const batch = channels.slice(i, i + this.config.batchSize);
      const inputs: ChannelLabelInput[] = batch.map((channel, index) => ({
        ref: `c${index + 1}`,
        title: channel.title,
        description: channel.description,
        keywords: channel.keywords,
        topicCategories: channel.topic_categories,
        subscriberCount: channel.subscriber_count,
        recentTitles: channel.recentTitles,
        recentTags: channel.recentTags,
      }));
      result.batches += 1;
      try {
        const response = await this.deps.text!.generateObject({
          system: LABEL_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildLabelPrompt(inputs) }],
          schema: labelBatchSchema,
          schemaName: "channel_labels",
          effort: "low",
          maxOutputTokens: 400 * batch.length + 2_000,
          ...(signal ? { signal } : {}),
        });
        result.inputTokens += response.usage.inputTokens;
        result.outputTokens += response.usage.outputTokens;
        const byRef = new Map(response.object.channels.map((label) => [label.ref, label]));
        for (const [index, channel] of batch.entries()) {
          const raw = byRef.get(`c${index + 1}`);
          const label = raw ? normalizeLabel(raw) : null;
          if (label) labels.set(channel.id, { label, model: response.model });
        }
      } catch (error) {
        this.log.warn("AI niche labeling batch failed; keeping rule labels", { size: batch.length, error });
        // Outages and rate limits: don't keep hammering the provider this run.
        if (!isAppError(error)) break;
      }
    }
    return labels;
  }

  private async save(channelId: string, label: RuleLabel, model: string, at: Date, entityIds: Map<string, Promise<string>>): Promise<void> {
    const entity = (slug: string, create: () => Promise<string>) => {
      const known = entityIds.get(slug);
      if (known) return known;
      const pending = create();
      entityIds.set(slug, pending);
      return pending;
    };
    const categorySlug = nicheSlug(label.category);
    const categoryId = await entity(categorySlug, () =>
      this.deps.niches.upsertEntity({ slug: categorySlug, name: label.category, kind: "category", parentId: null, aliases: [] }),
    );
    let nicheId = categoryId;
    let labels = label.subNiches;
    const primary = label.primary;
    // Only confident labels become niche entities; a guess stays a searchable sub-niche so it can't pollute the niche list.
    // ("Gaming" and a game called "Gaming" would share a slug; keep the category then.)
    if (primary && label.confidence >= CONFIDENT && primary.slug !== categorySlug) {
      nicheId = await entity(primary.slug, () =>
        this.deps.niches.upsertEntity({ slug: primary.slug, name: primary.name, kind: primary.kind, parentId: categoryId, aliases: primary.aliases }),
      );
    } else if (primary) {
      labels = [...new Set([primary.name.toLowerCase(), ...labels])].slice(0, 5);
    }

    await this.deps.channels.saveNicheLabel(channelId, {
      nicheId,
      category: label.category,
      labels,
      formats: label.formats,
      flags: label.flags,
      confidence: label.confidence,
      model,
      labeledAt: at,
    });
  }
}
