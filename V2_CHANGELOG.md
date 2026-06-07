# V2 Change Log

## Added

- Large File Mode for large NCBI XML uploads.
- Web Worker progress events with file progress, byte progress, record counter, and large-file status.
- Streaming BioSample parsing using `File.stream()` when available.
- Virtualized table rendering for large filtered datasets.
- Host → Laboratory Intelligence table.
- Laboratory extraction improvements using laboratory, collecting lab, sequencing center, center name, institution, and organization fields.
- Excel export now includes a `Host_Labs` worksheet.

## Changed

- The upload path now sends `File` objects directly to the worker instead of preloading all file text in the main UI thread.
- Large datasets avoid rendering all rows at once.
- Map marker cap is reduced when Large File Mode is active.
- Heavy charts are skipped in Large File Mode to keep the browser responsive.

## Notes

- BioSample XML is the main optimized target for v2.
- Assembly, SRA, and GenBank XML remain best-effort parsers.
- After merging, run `npm install && npm run build` and deploy the rebuilt `docs/` folder for GitHub Pages.
