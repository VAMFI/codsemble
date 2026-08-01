# Bounded usefulness comparison

Codesemble v0.2 compares compiler shape against two simple baselines without
claiming that structural tests prove real-world task outcomes.

| Boundary | Compatibility-library baseline | Single-primary baseline | Capability Compiler v1 |
| --- | --- | --- | --- |
| Selection | Every primitive remains visible to the selector | One general owner | Only roles justified by required Work Packages |
| Monorepo ownership | Catalog size does not express project units | One owner spans multiple units | One unit-scoped owner per admitted boundary |
| High-risk independence | A validator may exist but is not automatically justified | The author and verifier are the same identity | Recommended adds a distinct read-only validator |
| Small project | Candidate surface remains large | Appropriately one owner | Focused remains one role and does not pad |
| Concurrency | Independent input | Independent input | Independent input; never derived from catalog or team size |

The deterministic comparison suite uses the documentation-only, polyglot
monorepo, and regulated-delivery fixtures. It proves required coverage,
role-removal minimality, unit isolation, independent high-risk review, and no
role-count padding. It does not prove better completion quality, latency, model
cost, or production outcomes; those require separately designed task trials.
