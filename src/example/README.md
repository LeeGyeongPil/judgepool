# Synthetic example

Everything in this folder is invented (MIT, like the rest of the repository). It describes a made-up notes app called "Lumen Notes".

| File | What it is |
|---|---|
| `corpus.jsonl` | 37 entries, 36 distinct help passages (`rec-a2` repeats the text of `rec-a` under another doc id, like a re-chunked copy) |
| `queries.jsonl` | 6 questions |
| `bm25.run`, `dense.run`, `hybrid.run` | three retrieval runs, top 10 per question, TREC format |
| `judgments.jsonl` | grades 0-3 for every document any run returns, used by "Fill example judgments" |

The runs are written by rule, not produced by real retrievers: bm25 returns passages that share words with the question, dense also finds the paraphrased answers, hybrid mixes both. Judge only the bm25 pool and dense is scored as if those paraphrased answers were not relevant; judge all three pools and the order flips.

`bm25.run` question `q1` has two documents with the same score on purpose: trec_eval (and judgepool) order ties by doc id, descending, ignoring the rank column.

Regenerate with `node scripts/make-example.mjs`, then refresh the reference values with `cd scripts/ref && uv run python make_ref.py`.
