import type { z } from "zod";

/**
 * Provider-agnostic AI interfaces. Concrete providers (Anthropic, OpenAI,
 * ElevenLabs, image/video models...) implement these; services depend only on
 * the interfaces, so providers can be swapped or mixed per capability.
 */

export type AICapability = "text" | "embedding" | "image" | "voice" | "video";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TextGenerationRequest {
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Provider-specific model id; falls back to the provider default. */
  model?: string;
  signal?: AbortSignal;
}

export interface TextGenerationResult {
  text: string;
  model: string;
  usage: TokenUsage;
  stopReason: string | null;
}

export interface TextProvider {
  readonly name: string;
  generateText(request: TextGenerationRequest): Promise<TextGenerationResult>;
  /** Generate output validated against a Zod schema (e.g. structured niche analysis, script outlines). */
  generateObject<T extends z.ZodType>(
    request: TextGenerationRequest & { schema: T; schemaName: string },
  ): Promise<{ object: z.infer<T>; model: string; usage: TokenUsage }>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(inputs: string[]): Promise<number[][]>;
}

export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
  /** Reference image (e.g. an existing thumbnail) for edits/variations. */
  referenceImageUrl?: string;
}

export interface GeneratedAsset {
  /** Object path in lib/storage once persisted. */
  storagePath: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface ImageProvider {
  readonly name: string;
  generateImage(request: ImageGenerationRequest): Promise<GeneratedAsset>;
}

export interface VoiceoverRequest {
  text: string;
  voiceId: string;
  format?: "mp3" | "wav";
}

export interface VoiceProvider {
  readonly name: string;
  synthesize(request: VoiceoverRequest): Promise<GeneratedAsset>;
}

export interface VideoGenerationRequest {
  prompt: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
}

export interface VideoProvider {
  readonly name: string;
  /** Video generation is slow: providers return an external operation id that a job polls. */
  startGeneration(request: VideoGenerationRequest): Promise<{ operationId: string }>;
  getGeneration(operationId: string): Promise<{ status: "pending" | "succeeded" | "failed"; asset?: GeneratedAsset; error?: string }>;
}

export interface AIProviderMap {
  text: TextProvider;
  embedding: EmbeddingProvider;
  image: ImageProvider;
  voice: VoiceProvider;
  video: VideoProvider;
}
