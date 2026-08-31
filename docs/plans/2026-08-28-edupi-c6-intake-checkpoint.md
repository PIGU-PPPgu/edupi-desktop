# EduPi C6 staged intake checkpoint — 2026-08-28

## Outcome

Desktop and Core now share one receipt-bound path for `import_calendar`, `import_timetable`, and `intake_material`. Calendar and timetable entries become visible in the existing day/week/month workspace after the Core receipt; accepted materials move from Desktop staging into Core's teacher-material inbox and remain source/hash traceable.

## Pinned pair

- Core commit: `2f289557f05bc2526343c6c587b1de05ffcb6602`
- Core component manifest: `sha256:1d52f92e1f7762470667213a2d3d2dac24b7a02faded8d004f4c611c750bc6b6`
- Contract: v1.1; schema and fixture identities unchanged
- Enabled cumulative commands: `review_observation`, `review_memory_candidate`, `review_teacher_context`, `review_work_candidate`, `import_calendar`, `import_timetable`, `intake_material`
- Projection: `education_workspace`; `external_send=false`

## Shipped behavior

- Core owns intake state, idempotency, receipts, history, review targets, calendar/timetable mirrors, and material candidates.
- Invalid or unconfirmed calendar dates are held; Core does not invent dates.
- Desktop materials remain outside Core truth until the receipt-bound intake command verifies staging root, path, size, signature, and SHA-256.
- Desktop removes staging only after an accepted Core receipt.
- The schedule surface exposes compact `新建日程` and `添加课表` forms without replacing Chat or the day/week/month views.
- The materials surface exposes `接入 EduPi` and shows accepted Core receipt rows.

## Evidence

- Core intake bridge: one accepted calendar event plus one held invalid date, one timetable slot, one accepted PDF, exact replay, and tamper rejection.
- Desktop paired E2: `EDUPI_CORE_ROOT=<Core checkout> npm run test:edupi-c6-e2` passed with one confirmed and one visibly held calendar fact, one timetable slot, three intake receipts, and staging cleanup after receipt.
- Desktop full suite after the second adversarial repair loop: 626 passed, 13 skipped, 0 failed.
- Typecheck, lint/branding, audit, and `git diff --check` passed.
- Browser: material page, new-event form, timetable form, and month/week/day controls were exercised on `127.0.0.1:30141`.
- Production data remained unchanged after testing: 28 calendar facts, 0 timetable slots, 0 intake receipts, and empty Desktop staging.

## Next entry

Add the recognition layer from an accepted image/PDF/Word material to bounded calendar/timetable candidates. Extraction must preserve the material receipt/hash, write explicit dates directly, hold missing/invalid dates, and refresh the schedule automatically. This checkpoint proves transport and truth ownership; it does not claim general OCR/model extraction yet.

## Interaction correction

Calendar facts, timetable rows, tasks, pending items, and the left calendar/timetable object list now use keyboard-accessible buttons. Selecting any item opens a right-side drawer with the original teacher-facing fields (date, type, source, status, notes, class, period, or deliverables); no hash or internal material ID is shown. Browser checks covered a month-cell item, a left-side calendar node, close behavior, and date-to-day navigation with no console warning/error.

## Recognition layer — 2026-08-29

- Staging descriptors preserve and display the original filename.
- Browser and native uploads now automatically enter recognition after staging; failed recognition retains staging for retry.
- Images are sent directly to a tool-free, context-free recognition session. PDF text is extracted first, scan-only PDF files fall back to at most three rendered pages, DOCX uses local text extraction, and legacy DOC uses the system text converter when available.
- The recognition model receives only the original filename plus extracted text/images. It does not receive staging IDs or hashes, uses no tools, and runs with thinking disabled.
- Model output is limited to `events` and `slots`. Explicit Chinese dates are normalized to `YYYY-MM-DD`; ambiguous date phrases are preserved and Core holds them instead of guessing.
- The first real-model E2 exposed an evidence gap: it asserted only the two explicit dates, while the ambiguous event was silently absent. Core `2f289557f05bc2526343c6c587b1de05ffcb6602` fixes that behavior and the E2 now requires the ambiguous phrase to remain visible with `date=null`, `dateStatus=invalid`, and `preparationStatus=hold`.
- Recognition reads one descriptor-bound, hash-verified file descriptor, rejects symlinks and byte swaps, caps DOCX expansion and PDF raster output, caches the bounded result for stable retries, and admits at most two recognition runs globally with one run per staged material.
- DOCX decompression runs in a separate Node process with a fixed heap, output cap, and timeout, so forged ZIP size metadata cannot exhaust the Desktop server heap. Timetable provenance markers are length-bounded and every current timetable surface renders recognized slots as pending.
- A multi-command retry is resumable: Core recognizes a previously accepted source/item set as `already_applied`, does not duplicate canonical facts or audit rows, and recovers a receipt-bound material whose final rename was interrupted.
- Source replay now validates provenance first and compares a canonical full-command fingerprint; altered semantics return `source_conflict`. Live lock owners are protected by PID liveness even after the age threshold, with a cross-process regression test. Same-name held events retain distinct raw dates/sources instead of swallowing one another.
- The isolated real-model E2 passed with three recognized events and one weekly slot: two explicit but still inferred events, one visible ambiguous event, one marked pending timetable slot, the original filename in the intake projection, and staging cleanup only after all three receipts completed.
- Browser-facing intake targets and timetable records omit staging IDs, source hashes, source paths, and internal evidence IDs; the real-model E2 asserts the teacher-facing projection contains neither `stg_` nor `sha256:`.

Residual: recognition still depends on the configured model/provider and local PDF/DOC conversion utilities. When any of those are unavailable, the original staged file remains visible with a retry action; canonical Core data is not mutated. “100% confidence” in this checkpoint means no known reproducible defect inside the documented local-file/intake threat model after deterministic tests, a real-provider isolated E2, full regression, runtime verification, and successive fresh-context adversarial reviews ending with no substantive findings; it is not a claim that external providers or operating systems cannot fail.

## Adversarial closure — 2026-08-29

The audit loop converged from 8 substantive findings, to 6, to 1, to a final fresh-context review with `未发现实质性问题`. The final review rechecked explicit-versus-held calendar identity, Core pin/manifest identity, intake replay, lock liveness, resource containment, pending-state UI, and browser DTO redaction. Final deterministic gates were 626 passed / 13 skipped / 0 failed on Desktop, 65/65 plus the cross-process lock test on Core, C1/C2/C3/C6/real-DOCX E2 all green, and dependency audit at zero known vulnerabilities.

After the final commits, the restarted `127.0.0.1:30141` runtime reported Core/projection ready with the pinned component manifest, while production remained 28 calendar facts, 0 timetable slots, 0 intake receipts, and 0 staged materials. Browser smoke opened Today, navigated to the month schedule, and opened a calendar detail drawer; the page exposed all 28 calendar nodes and produced no console warning or error.
