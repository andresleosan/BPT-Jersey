let memberDirectoryDomainUrl;

export function initialize(data) {
  const candidate = new URL(data?.memberDirectoryDomainUrl ?? "invalid:");
  if (
    candidate.protocol !== "file:" ||
    candidate.search !== "" ||
    candidate.hash !== "" ||
    !candidate.pathname.endsWith("/packages/domain/lib/members/member-directory-contracts.js")
  ) {
    throw new Error("Invalid member-directory runner runtime mapping.");
  }
  memberDirectoryDomainUrl = candidate.href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@bpt-jersey/domain/members/directory") {
    if (memberDirectoryDomainUrl === undefined) {
      throw new Error("Missing member-directory runner runtime mapping.");
    }
    return { url: memberDirectoryDomainUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
