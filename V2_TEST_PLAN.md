# V2 Test Plan

## 1. Install and build

```bash
npm install
npm run build
```

Expected: TypeScript and Vite build complete successfully.

## 2. Small BioSample XML

Upload a small BioSample XML file.

Expected:

- Records are parsed.
- Summary cards update.
- Charts render.
- Explorer table works.
- Host → Laboratory table appears.

## 3. Large BioSample XML

Upload a large BioSample XML file, ideally 50K+ records.

Expected:

- Progress bar appears.
- Large File Mode activates.
- UI remains responsive.
- Explorer table scrolls smoothly.
- Host → Laboratory Intelligence loads.
- Exports work.

## 4. Host and lab validation

Check several records manually against the XML.

Expected:

- host is extracted from host / host common name / host scientific name when available.
- lab name is extracted from laboratory / collecting lab / sequencing center / center name / institution / organization where available.

## 5. Export validation

Export Excel.

Expected:

- `Records` worksheet contains parsed records.
- `Host_Labs` worksheet contains host-level lab summaries.
