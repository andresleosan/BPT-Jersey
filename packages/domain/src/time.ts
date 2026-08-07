declare const utcDateTimeBrand: unique symbol;

export type UtcDateTime = string & {
  readonly [utcDateTimeBrand]: "UtcDateTime";
};
