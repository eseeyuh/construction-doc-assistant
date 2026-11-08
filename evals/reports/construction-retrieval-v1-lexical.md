# Construction retrieval v1: lexical

**Execution mode: lexical-only (offline: PostgreSQL full-text, no embeddings, no model calls).**

- Dataset: `construction-retrieval` v1, 14 cases, sha256 `a437d8e8d905622cee9a5e1f9a8878ce9c49ad241ca3a01bbafbfa4cda149a7c`
- Ran: 2026-11-08T21:25:18+00:00; top 10
- Versions: chunker `span-pack/v1`, lexical `pg-fts-english/v2`, supersession_rules `revision-supersession/v1`
- Embedding space: none (no embeddings used)
- Database after the run: {'chunks': 8, 'chunk_embedding_links': 0, 'model_calls': 0}

| Cases | Hit@1 | Hit@3 | Hit@10 | MRR@10 | Invariant violations |
|---:|---:|---:|---:|---:|---:|
| 14 | 12/14 | 14/14 | 14/14 | 0.9286 | 0/5 |

| Case | Revisions | Rank | Returned (in order) | Forbidden returned |
|---|---|---:|---|---|
| notice-current | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p2,3,4; IP-01_Inspection_Procedure_RevB.pdf p1,2; CT-01_Commercial_Terms.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3; SSR-01_Site_Safety_Rules.pdf p1,2 | none |
| notice-history | all | 2 | IP-01_Inspection_Procedure_RevB.pdf p2,3,4; IP-01_Inspection_Procedure_RevA.pdf p2,3,4; IP-01_Inspection_Procedure_RevA.pdf p1,2; IP-01_Inspection_Procedure_RevB.pdf p1,2 | n/a |
| notice-current-old-figure | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p2,3,4; IP-01_Inspection_Procedure_RevB.pdf p1,2 | none |
| revision-note | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p2,3,4 | none |
| covering-work | current | 2 | IP-01_Inspection_Procedure_RevB.pdf p1,2; IP-01_Inspection_Procedure_RevB.pdf p2,3,4; SSR-01_Site_Safety_Rules.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3; CT-01_Commercial_Terms.pdf p1,2; CT-01_Commercial_Terms.pdf p2,3 | none |
| inspection-record | current | 1 | IP-01_Inspection_Procedure_RevB.pdf p2,3,4; IP-01_Inspection_Procedure_RevB.pdf p1,2; CT-01_Commercial_Terms.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3 | none |
| ppe | current | 1 | SSR-01_Site_Safety_Rules.pdf p1,2; IP-01_Inspection_Procedure_RevB.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p2,3,4; CT-01_Commercial_Terms.pdf p1,2; CT-01_Commercial_Terms.pdf p2,3 | n/a |
| ppe-paraphrase | current | 1 | SSR-01_Site_Safety_Rules.pdf p1,2 | n/a |
| hi-vis | current | 1 | SSR-01_Site_Safety_Rules.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p2,3,4 | n/a |
| visitors | current | 1 | SSR-01_Site_Safety_Rules.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p1,2; IP-01_Inspection_Procedure_RevB.pdf p2,3,4; SSR-01_Site_Safety_Rules.pdf p1,2 | n/a |
| induction-paraphrase | current | 1 | SSR-01_Site_Safety_Rules.pdf p2,3; CT-01_Commercial_Terms.pdf p1,2 | n/a |
| application-1 | current | 1 | CT-01_Commercial_Terms.pdf p1,2; CT-01_Commercial_Terms.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p2,3,4 | n/a |
| pay-period | current | 1 | CT-01_Commercial_Terms.pdf p1,2; CT-01_Commercial_Terms.pdf p2,3; IP-01_Inspection_Procedure_RevB.pdf p1,2; SSR-01_Site_Safety_Rules.pdf p1,2 | n/a |
| retention | current | 1 | CT-01_Commercial_Terms.pdf p1,2; CT-01_Commercial_Terms.pdf p2,3 | n/a |

The corpus is four short synthetic PDFs (3-4 pages, one chunk per page), so these numbers check the pipeline's behaviour (revision filtering, citations, ranking plumbing); they are not evidence of retrieval quality on real project documents.
