# Local collection intake

This compatibility adapter feeds the existing `installPrivateLibrary` path. It does not create a question engine, a cloud catalog, or an approval bypass.

Accepted: root/wrapped prepared catalogs and native manifest/questions/assets folders, including several source banks in one selection. Native packages produce a virtual catalog only in memory. Source words, question IDs, set/number relationships, week scope, answer evidence, flags, and asset visibility are preserved by the canonical readers. The original is hashed when supplied; absent original bytes are reported, never invented.

ZIP preflight rejects duplicate/case/Unicode path collisions, unsafe paths, symlinks, unsupported layouts, per-file/total bounds, and mismatched local headers. Streaming reads validate actual inflated lengths and CRC before delivering bytes. ZIP64, encrypted, legacy non-UTF-8 and split archives use the folder route instead. This is bounded archive intake, not a malware scanner.

A missing named image is a clear error; no image is guessed or silently reattached. Raw PDFs/Word/text without a native manifest still use the existing QBank file importer. Source answer evidence is not human approval. No local input is sent to the cloud by this module.

Tests: `inputRoot.test.ts`, `zipIndex.test.ts`, `nativeInput.test.ts`, `fileInput.test.ts`. Before merge, run those plus existing `install.test.ts`, then the web typecheck/lint/build and actual browser import/save/reload. The same source version must not duplicate attempts or overwrite existing reviewed mappings. Hosted release and multi-user publication are separate acceptance gates tracked in issue #22.
