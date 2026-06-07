import type { NcbiRecord } from './types';

export const fields: (keyof NcbiRecord)[] = [
  'sourceFile','fileType','accession','taxonomyId','organism','scientificName','commonName','bioSampleAccession','bioProjectAccession','sraAccession','assemblyAccession','collectionDate','collectionYear','collectionMonth','country','region','city','geoLocation','latitude','longitude','host','hostSpecies','isolationSource','strain','isolate','serotype','serovar','sampleType','laboratory','institution','organization','owner','submitter','submissionDate','publicationDate','lastUpdateDate','recordStatus'
];

export function countBy(records: NcbiRecord[], key: keyof NcbiRecord) {
  const map = new Map<string, number>();
  for (const record of records) {
    const value = String(record[key] || 'Unknown');
    map.set(value, (map.get(value) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function unique(records: NcbiRecord[], key: keyof NcbiRecord) {
  return new Set(records.map(r => r[key]).filter(Boolean)).size;
}

export function present(records: NcbiRecord[], key: keyof NcbiRecord) {
  return records.filter(r => r[key]).length;
}

export function missingRows(records: NcbiRecord[]) {
  return records.filter(r => !r.collectionDate || !r.country || !r.host || !r.bioProjectAccession || !r.bioSampleAccession || !r.laboratory);
}

export function escapeCsv(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function toCsv(records: NcbiRecord[]) {
  const header = fields.join(',');
  const rows = records.map(r => fields.map(f => escapeCsv(r[f])).join(','));
  return [header, ...rows].join('\n');
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
