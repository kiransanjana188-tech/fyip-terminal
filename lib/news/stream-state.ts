import type { NewsStoryDTO } from "@/lib/client/types";

/** Pure reducer used by the FYP NEWS UI and its tests. */
export function mergeNewsStories(
  current: NewsStoryDTO[],
  incoming: NewsStoryDTO[],
  max = 400,
): NewsStoryDTO[] {
  if (incoming.length === 0) return current.length > max ? current.slice(0, max) : current;
  const map = new Map(current.map((story) => [story.id, story]));
  for (const story of incoming) map.set(story.id, story);
  return [...map.values()]
    .sort((a, b) => {
      if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? 1 : -1;
      if (a.urgency !== b.urgency) return b.urgency - a.urgency;
      return a.id < b.id ? 1 : -1;
    })
    .slice(0, Math.max(1, max));
}

export function newBreakingIds(previous: Set<string>, incoming: NewsStoryDTO[]): string[] {
  return incoming.filter((story) => story.isBreaking && !previous.has(story.id)).map((story) => story.id);
}
