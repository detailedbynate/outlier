"use client";

import { useState } from "react";
import { useTypewriter } from "@/components/use-typewriter";

/** Example questions the placeholder types out, one after another. */
const PLACEHOLDERS = [
  'Try "good niches around fitness"',
  'Try "underrated niches"',
  'Try "minecraft"',
  'Try "top niches"',
  'Try "my singing monsters"',
];

/** The Niche Finder's search box, with the same typed-out examples as Shorts Channels. */
export function TopicInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  // Only animate while the placeholder is actually visible.
  const placeholder = useTypewriter(PLACEHOLDERS, value.length === 0);
  return (
    <input
      id="topic"
      name="topic"
      type="search"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={placeholder}
      maxLength={120}
      autoComplete="off"
      required
    />
  );
}
