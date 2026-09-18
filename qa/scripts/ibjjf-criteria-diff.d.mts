export type CriteriaDiffCounts = {
  regyfitLevels: number;
  bptLevels: number;
  onlyRegyfit: number;
  onlyBpt: number;
  criteriaDiffLevels: number;
  regyfitSkills: number;
  bptSkills: number;
  onlyRegyfitSkills: number;
  skillMinimumDiffLevels: number;
};
export function minimumDaysOf(
  time: { years: number; months: number; days: number } | null,
): number | null;
export function buildCriteriaDiff(input: {
  v1Observed: unknown;
  v1Business: unknown;
  regyfit: unknown;
}): {
  markdown: string;
  counts: CriteriaDiffCounts;
};
