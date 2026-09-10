import type { EntityId } from "./identifiers";

export type PageCursor = EntityId<"PageCursor">;

export type PageRequest = {
  readonly cursor?: PageCursor;
  readonly limit: number;
};

export type Page<T> = {
  readonly items: readonly T[];
  readonly nextCursor?: PageCursor;
};
