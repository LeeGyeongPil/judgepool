# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-17

### Fixed
- `--lang` placed after an invalid option is now honoured for the error message instead of falling back to `LANG`.

## [0.1.0] - 2026-11-17

### Added
- Load run files (TREC, JSONL, CSV), BEIR queries and corpus, existing qrels (TREC, BEIR TSV) and judgepool backups, with format auto-detection and line-numbered problem reports.
- Depth-k pooling over the runs you choose, duplicate removal by doc id and by identical passage text, and pool growth that keeps earlier judgments and asks only for the new documents.
- Blind judging screen (no system name, no rank) with a seeded order, keyboard grades 0-3, skip, undo, progress, and autosave to IndexedDB with session resume.
- Comparison table with nDCG@k, Recall@k, P@k, MRR and judged@k that matches ir_measures / trec_eval values, rel>=1 or rel>=2, two averaging modes, and pooling-bias warnings.
- Export to TREC qrels, BEIR TSV and a JSONL backup that round-trips.
- Synthetic example that reproduces the ranking flip caused by pooling bias.
- English and Korean screens (language menu) and CLI (`--lang`, `JUDGEPOOL_LANG`).
- `judgepool` command: static server on 127.0.0.1 with a Content-Security-Policy that forbids network requests.
