# NCBI XML BioSurveillance Dashboard

A fully static, browser-only dashboard for NCBI XML metadata surveillance.

## What it does

- Upload one or more XML files exported manually from NCBI.
- Priority support for BioSample XML.
- Best-effort support for Assembly, SRA, and Nucleotide / GenBank XML.
- Parse locally in the browser using a Web Worker.
- No backend, database, API key, authentication, or cloud service.
- Generate summary cards, metadata quality metrics, charts, map, table explorer, duplicate/orphan checks, and exports.
- Export CSV, XLSX, and PDF reports.


## Local development

Only needed if you want to edit the source code.

```bash
npm install
npm run dev
```

## Rebuild for GitHub Pages

Only needed if you change files inside `src/`.

```bash
npm install
npm run build
```

The build output goes directly to `docs/`.

## Project structure

```text
.
├── docs/                 # Ready-to-deploy GitHub Pages build
├── public/samples/       # Sample XML files
├── src/                  # React + TypeScript source code
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Privacy

All XML parsing and processing happens locally in the user's browser. Files are not uploaded anywhere.

## Important note

The Web Worker parser does **not** use `DOMParser`, so it avoids the `DOMParser is not defined` issue in Worker environments.
