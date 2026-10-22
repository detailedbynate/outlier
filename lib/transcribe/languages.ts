/**
 * Languages offered in the picker. Whisper reads many more, but this build of
 * it doesn't detect the language by itself (it falls back to English), so the
 * person picks. The common Shorts languages, English first.
 */
export const TRANSCRIBE_LANGUAGES = [
  ["en", "English"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["vi", "Vietnamese"],
  ["tl", "Filipino"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
] as const;

export type TranscribeLanguage = (typeof TRANSCRIBE_LANGUAGES)[number][0];

export const isTranscribeLanguage = (value: unknown): value is TranscribeLanguage => TRANSCRIBE_LANGUAGES.some(([code]) => code === value);

/** Longest recording one go takes. Shorts are 3 minutes at most; this leaves room for a long voiceover. */
export const TRANSCRIBE_MAX_SECONDS = 5 * 60;
