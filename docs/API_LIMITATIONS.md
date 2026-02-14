# API Limitations and Access Levels

Scopus APIs distinguish between public and institutional access (via InstToken or university network/VPN). Access level affects which metadata fields are returned.

## Abstract Retrieval (Scopus Abstract Retrieval API)

- Full abstracts are reliably available with institutional access (InstToken or inside university network/VPN).
- Without institutional access, automatic abstract enrichment is incomplete and tends to work only for Open Access items.
- Reference: Abstract Retrieval response views (BASIC, META, META_ABS, REF, FULL): https://dev.elsevier.com/sc_abstract_retrieval_views.html

## Author Metadata (Scopus Author Retrieval API)

- Without institutional access, the API reliably returns only the first author label (`dc:creator`).
- The full `author` list (per‑author entries with IDs/affiliations/ORCIDs) used for multi‑author parsing usually requires institutional access.
- Reference: Author Retrieval response views (BASIC, METRICS, LIGHT, STANDARD, ENHANCED): https://dev.elsevier.com/sc_author_retrieval_views.html

## Guidance and Workflow Implications

- Search endpoints still match author and abstract terms, but returned metadata may be limited without InstToken/university network.
- For complete abstracts and author lists, run inside your institution’s network or supply a valid InstToken.
- Structure screening with a two‑ to three‑stage flow (Hits → Selected → Corpus) and plan for manual abstract enrichment when institutional access is not available.
- Expect rate limits; implement backoff and retries. Temporary pauses/failures can occur without InstToken.

