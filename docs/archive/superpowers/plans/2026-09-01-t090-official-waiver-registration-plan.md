# T090 - Implementation plan

1. Add the official PDF to the web public asset and Functions consent runtime asset; verify both copies match the source hash.
2. Add RED tests for evidence preserving the source pages, the registration UI showing the official document, and profile completion navigating to the waiver step.
3. Implement the evidence generator by loading the immutable source PDF and appending the existing authenticated signature record.
4. Update the waiver UI copy, embedded document panel and post-profile navigation while retaining existing consent payloads and authorization.
5. Extend build packaging so the Functions runtime asset is present in `.firebase-functions`.
6. Run focused tests, then the project verification gates and complete the self-critique loop.
