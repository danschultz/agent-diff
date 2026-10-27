// The last height each file's diff had while its editor was mounted, so a
// file keeps its height once its editor unmounts, and the scroll position
// doesn't jump (decision 0045). Files are named by their working directory's
// real path and their path in it.
import { createImmerStore } from '../createImmerStore.ts';

export function fileKey(workingDirectory: string, path: string): string {
  return `${workingDirectory}\0${path}`;
}

export const fileHeightsStore = createImmerStore(
  { heights: {} as Record<string, number> },
  ({ update, get }) => ({
    setHeight(key: string, height: number) {
      update((s) => (s.heights[key] = height));
    },
    // Undefined until the file's editor has mounted once.
    height(key: string) {
      return get().heights[key];
    },
  }),
);
