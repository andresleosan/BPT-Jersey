import {
  assertChunkSequence,
  memberDirectoryChunkReceiptSchema,
  parseMemberDirectoryChunkId,
} from "@bpt-jersey/domain/members/directory-migration";

import {
  constantTimeMacEquals,
  createMemberDirectoryIdentityBaselineMac,
} from "./member-directory-crypto.js";

/**
 * Bootstrap verification (T108): the proof that has to hold before the parent may move
 * `applying -> verified`, and again, unchanged, before it may move `verified -> completed`.
 *
 * The spec is specific about why this is one function called twice rather than a flag set once. A
 * crash between verification and completion must resume into the completion transaction only, and
 * that transaction has to re-establish the same proof rather than trust a verified parent it found
 * lying around. So the proof is a pure function of what Firestore holds, computed from scratch both
 * times, and it changes nothing.
 *
 * What it proves is narrow and worth stating exactly: that the chunks of this operation form a
 * complete sequence with no holes, that the identities they claim to have reserved are exactly the
 * set the baseline artifact was built from, and that nothing has been added or removed since.
 */

export type MemberDirectoryBootstrapChunkEvidence = Readonly<{
  /** The committed chunk receipt, as stored. */
  receipt: unknown;
  /** The `(kind,keyId,ownerStudentId,digestVersion,secretVersion)` tuples that chunk covered. */
  tuples: readonly string[];
}>;

export type MemberDirectoryBootstrapVerificationInput = Readonly<{
  academyId: string;
  operationId: string;
  secretVersion: string;
  /** Every committed chunk of the operation, in ascending chunk order. */
  chunks: readonly MemberDirectoryBootstrapChunkEvidence[];
  /** The MAC recorded in the encrypted baseline artifact this operation prepared. */
  artifactBaselineMac: string;
}>;

export type MemberDirectoryBootstrapVerification = Readonly<{
  identityKeyBaselineMac: string;
  identityCount: number;
  chunkCount: number;
  writtenCount: number;
}>;

function verificationFailure(reason: string): never {
  throw new Error(`Member directory bootstrap verification refused: ${reason}`);
}

export function verifyMemberDirectoryBootstrapBaseline(
  input: MemberDirectoryBootstrapVerificationInput,
  dependencies: Readonly<{ integritySecretMaterial: string }>,
): MemberDirectoryBootstrapVerification {
  if (input.chunks.length === 0) {
    verificationFailure("an operation with no committed chunk has no baseline to verify");
  }

  const chunkNos: number[] = [];
  const tuples: string[] = [];
  let writtenCount = 0;

  input.chunks.forEach((chunk, index) => {
    const receipt = memberDirectoryChunkReceiptSchema.parse(chunk.receipt);
    if (receipt.operationId !== input.operationId || receipt.academyId !== input.academyId) {
      verificationFailure("a chunk receipt belongs to another operation or academy");
    }
    if (receipt.phase !== "bootstrap") {
      verificationFailure(`a ${receipt.phase} chunk cannot prove an identity-key baseline`);
    }
    // The stored ID is re-parsed rather than trusted: it is the only field that ties the receipt to
    // its own position in the sequence, and a receipt whose ID disagrees with its fields is exactly
    // what the sequence check would otherwise skip over.
    const parsed = parseMemberDirectoryChunkId(receipt.chunkId);
    if (parsed.chunkNo !== receipt.chunkNo) {
      verificationFailure("a chunk receipt disagrees with its own identifier");
    }
    if (index > 0 && receipt.chunkNo <= (chunkNos[index - 1] ?? 0)) {
      verificationFailure("chunk receipts must be presented in ascending order");
    }
    chunkNos.push(receipt.chunkNo);
    writtenCount += receipt.writtenCount;
    tuples.push(...chunk.tuples);
  });

  // Fails closed on a hole rather than verifying whatever survived it.
  assertChunkSequence(chunkNos);

  const identityKeyBaselineMac = createMemberDirectoryIdentityBaselineMac({
    academyId: input.academyId,
    operationId: input.operationId,
    secretVersion: input.secretVersion,
    tuples,
    secretMaterial: dependencies.integritySecretMaterial,
  });

  if (!constantTimeMacEquals(identityKeyBaselineMac, input.artifactBaselineMac)) {
    /**
     * The recomputed set and the artifact disagree, which means an identity was added, removed or
     * reassigned between planning and now. There is no safe repair here: the baseline is the thing
     * every later writer proves itself against, so a wrong one is worse than none.
     */
    verificationFailure("the recomputed identity baseline does not match its artifact");
  }

  return Object.freeze({
    identityKeyBaselineMac,
    identityCount: tuples.length,
    chunkCount: chunkNos.length,
    writtenCount,
  });
}
