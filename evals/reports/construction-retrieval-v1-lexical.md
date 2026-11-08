# Construction retrieval v1: lexical

**Execution mode: lexical-only (offline: PostgreSQL full-text, no embeddings, no model calls).**

- Dataset: `construction-retrieval` v1, 14 cases, sha256 `4a7a8c2680c33ef74c7b7e4de2abd90b881c4713ecb3315ade497c627c74d4ea`
- Ran: 2026-11-08T11:45:16+00:00; top 10
- Versions: chunker `span-pack/v1`, lexical `pg-fts-english/v2`, supersession_rules `revision-supersession/v1`
- Embedding space: none (no embeddings used)
- Database after the run: {'chunks': 4, 'chunk_embedding_links': 0, 'model_calls': 0}

| Cases | Hit@1 | Hit@3 | Hit@10 | MRR@10 | Invariant violations |
|---:|---:|---:|---:|---:|---:|
| 14 | 12/14 | 13/14 | 13/14 | 0.8929 | 0/5 |

| Case | Revisions | Rank | Returned (in order) | Forbidden returned |
|---|---|---:|---|---|
| notice-current | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p1; CT-01_Commercial_Terms.pdf p1; SSR-01_Site_Safety_Rules.pdf p1 | none |
| notice-history | all | 2 | IP-01_Inspection_Procedure_RevB.pdf p1; IP-01_Inspection_Procedure_RevA.pdf p1 | n/a |
| notice-current-old-figure | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p1 | none |
| revision-note | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p1 | none |
| covering-work | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p1; SSR-01_Site_Safety_Rules.pdf p1; CT-01_Commercial_Terms.pdf p1 | none |
| inspection-record | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p1; SSR-01_Site_Safety_Rules.pdf p1 | none |
| ppe | current | 1 | SSR-01_Site_Safety_Rules.pdf p1; IP-01_Inspection_Procedure_RevB.pdf p1 | n/a |
| ppe-paraphrase | current | miss | none | n/a |
| hi-vis | current | 1 | SSR-01_Site_Safety_Rules.pdf p1 | n/a |
| visitors | current | 1 | SSR-01_Site_Safety_Rules.pdf p1; IP-01_Inspection_Procedure_RevB.pdf p1 | n/a |
| induction-paraphrase | current | 1 | SSR-01_Site_Safety_Rules.pdf p1 | n/a |
| application-1 | current | 1 | CT-01_Commercial_Terms.pdf p1; IP-01_Inspection_Procedure_RevB.pdf p1; SSR-01_Site_Safety_Rules.pdf p1 | n/a |
| pay-period | current | 1 | CT-01_Commercial_Terms.pdf p1 | n/a |
| retention | current | 1 | CT-01_Commercial_Terms.pdf p1 | n/a |

The corpus is four one-page synthetic PDFs (one chunk per revision), so these numbers check the pipeline's behaviour (revision filtering, citations, ranking plumbing); they are not evidence of retrieval quality on real project documents.
