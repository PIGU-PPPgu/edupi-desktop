# Design QA — EduPi 课程表 V3

source visual truth path: `/var/folders/xk/qmn_r8g93ljb7b5vqzq3rd040000gn/T/codex-clipboard-9100b5aa-5cdb-488f-9982-ed95bd4584f2.png`

implementation screenshot path: `output/design-qa/timetable-v3-normalized.png`

combined comparison path: `output/design-qa/timetable-comparison-normalized.png`

viewport: 1600 × 1000 CSS px, Codex in-app browser

source pixels: 1862 × 1060

implementation capture: 1044 × 728 canvas; in-app clip returned the rendered component in the left 522 px because of capture-density scaling. The component region was cropped to 522 × 728 and both source and implementation were scaled to 1200 px width for comparison.

state: 教学工作区 → 课程表；真实 6 条数学 / 703 课程数据

## Full-view comparison

- Information architecture matches the reference: one period column, Monday–Friday columns, ten period rows, and a visible lunch break before period six.
- The six course positions match the supplied schedule exactly: Tuesday/Thursday/Friday period 1; Monday/Wednesday/Friday period 2.
- The implementation intentionally omits the teacher-name title inside the grid because the containing EduPi page already owns the page title and navigation.
- The reference uses a document-style black table. The implementation keeps the same geometry but maps it to EduPi tokens: light borders, neutral surface and restrained green course cells.

## Focused region comparison

The timetable itself was captured without the surrounding navigation. Dense table details were readable at normalized width: weekday headings, period labels, subject, class, empty cells and lunch divider were all compared.

## Required fidelity surfaces

- Fonts and typography: Chinese system sans-serif in both; implementation uses smaller UI optical weights appropriate to the Desktop workbench. No clipped or wrapped labels.
- Spacing and layout rhythm: column and row rhythm follows the reference; period six starts after a clear 12 px lunch divider.
- Colors and visual tokens: intentional EduPi/Notion adaptation; semantic course fill has adequate contrast and does not replace structure with decoration.
- Image quality and assets: the source contains no required raster assets, logos or non-standard icons inside the timetable.
- Copy and content: weekday, period, subject and class labels match the reference data.

## Interaction evidence

- Existing course cells open the calendar route/detail flow.
- Teaching secondary navigation opens the full course table and exposes `← 教学首页` on subpages.
- Calendar `课程表` content mode opens the same ten-period grid and keeps right-side editing.
- Browser console: 0 errors, 0 warnings.

## Comparison history

1. Initial capture contained a density-scaled blank right half from the in-app clip.
2. Normalized to the rendered component crop; no P0/P1/P2 structure or fidelity findings remained.

## Follow-up polish

- P3: optional printing/export styling can use stronger black borders when a teacher chooses “打印课表”.

final result: passed
