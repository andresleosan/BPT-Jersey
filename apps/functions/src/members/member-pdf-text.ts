type MemberPdfTextItem = Readonly<{
  str: string;
  x: number;
  y: number;
  page?: number;
}>;

const headerTerms = /member|numero de socio|número de sócio/iu;
const footerTerms = /^document produced by www\.regyfit\.com\b/iu;

function groupTextItems(items: readonly MemberPdfTextItem[]): MemberPdfTextItem[][] {
  const groups: MemberPdfTextItem[][] = [];
  for (const item of items) {
    const page = item.page ?? 0;
    const group = groups.find(
      (candidate) =>
        (candidate[0]?.page ?? 0) === page && Math.abs((candidate[0]?.y ?? 0) - item.y) < 0.5,
    );
    if (group === undefined) groups.push([item]);
    else group.push(item);
  }
  return groups.sort((left, right) => {
    const leftPage = left[0]?.page ?? 0;
    const rightPage = right[0]?.page ?? 0;
    if (leftPage !== rightPage) return leftPage - rightPage;
    return (right[0]?.y ?? 0) - (left[0]?.y ?? 0);
  });
}

function sortedItems(items: readonly MemberPdfTextItem[]): MemberPdfTextItem[] {
  return [...items].sort((left, right) => left.x - right.x);
}

function looksLikeHeader(items: readonly MemberPdfTextItem[]): boolean {
  return items.length >= 6 && headerTerms.test(items.map((item) => item.str).join(" "));
}

function lineText(items: readonly MemberPdfTextItem[]): string {
  return sortedItems(items)
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ");
}

function nearestColumn(x: number, anchors: readonly number[]): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  anchors.forEach((anchor, index) => {
    const candidateDistance = Math.abs(anchor - x);
    if (candidateDistance < distance) {
      nearest = index;
      distance = candidateDistance;
    }
  });
  return nearest;
}

function rowText(items: readonly MemberPdfTextItem[], anchors: readonly number[]): string {
  const columns = Array.from({ length: anchors.length }, () => "");
  for (const item of sortedItems(items)) {
    const column = nearestColumn(item.x, anchors);
    const current = columns[column] ?? "";
    columns[column] = current.length === 0 ? item.str.trim() : `${current} ${item.str.trim()}`;
  }
  return columns.join(" | ");
}

export function formatMemberPdfTextItems(items: readonly MemberPdfTextItem[]): string {
  let anchors: readonly number[] = [];
  const lines: string[] = [];
  for (const group of groupTextItems(items)) {
    if (looksLikeHeader(group)) {
      anchors = sortedItems(group).map((item) => item.x);
      lines.push(
        sortedItems(group)
          .map((item) => item.str.trim())
          .join(" | "),
      );
      continue;
    }
    const text = lineText(group);
    if (text.length === 0) continue;
    if (footerTerms.test(text) || anchors.length === 0 || group.length === 1) lines.push(text);
    else lines.push(rowText(group, anchors));
  }
  return lines.join("\n");
}
