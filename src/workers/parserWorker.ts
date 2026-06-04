import type { NcbiRecord, ParseResult } from '../types';

type UploadFile = { name: string; text: string };

function clean(value?: string | null): string | undefined {
  const out = (value || '').replace(/\s+/g, ' ').trim();
  if (!out || out.toLowerCase() === 'missing' || out.toLowerCase() === 'not provided') return undefined;
  return out;
}

function stripTags(value?: string | null): string | undefined {
  return clean(String(value || '').replace(/<[^>]*>/g, ' '));
}

function attr(block: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*['\"]([^'\"]*)['\"]`, 'i');
  return clean(block.match(re)?.[1]);
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<(?:[A-Za-z0-9_\\-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_\\-]+:)?${name}>`, 'i');
  return stripTags(block.match(re)?.[1]);
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_\\-]+:)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z0-9_\\-]+:)?${name}>`, 'gi');
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) out.push(match[0]);
  return out;
}

function attributes(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<(?:[A-Za-z0-9_\-]+:)?Attribute\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_\-]+:)?Attribute>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const key = attr(match[1], 'attribute_name') || attr(match[1], 'harmonized_name') || attr(match[1], 'display_name') || attr(match[1], 'name');
    const value = stripTags(match[2]);
    if (key && value) out[key.toLowerCase()] = value;
  }
  return out;
}

function pick(attrs: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attrs[key.toLowerCase()];
    if (value) return value;
  }
}

function id(block: string, re: RegExp): string | undefined {
  return clean(block.match(re)?.[0]);
}

function year(value?: string): string | undefined {
  return clean(value?.match(/(19|20)\d{2}/)?.[0]);
}

function month(value?: string): string | undefined {
  const m = value?.match(/\d{4}[-/](\d{1,2})/);
  return m ? m[1].padStart(2, '0') : undefined;
}

function geo(value?: string): Partial<NcbiRecord> {
  if (!value) return {};
  const parts = value.split(':').map(x => clean(x) || '').filter(Boolean);
  const detail = (parts[1] || '').split(',').map(x => clean(x) || '');
  return { country: parts[0], region: detail[0] || undefined, city: detail[1] || undefined, geoLocation: value };
}

function latlon(value?: string): Partial<NcbiRecord> {
  const nums = value?.match(/-?\d+(?:\.\d+)?/g) || [];
  if (nums.length < 2) return {};
  let latitude = Number(nums[0]);
  let longitude = Number(nums[1]);
  const upper = value!.toUpperCase();
  if (/\bS\b/.test(upper)) latitude = -Math.abs(latitude);
  if (/\bW\b/.test(upper)) longitude = -Math.abs(longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return {};
  return { latitude: String(latitude), longitude: String(longitude) };
}

function detect(xml: string): string {
  const start = xml.slice(0, 5000).toLowerCase();
  if (start.includes('biosample')) return 'BioSample';
  if (start.includes('experiment_package') || start.includes('<sra')) return 'SRA';
  if (start.includes('gbseq')) return 'Nucleotide/GenBank';
  if (start.includes('assembly')) return 'Assembly';
  return 'Generic';
}

function parseBioSample(block: string, sourceFile: string, index: number): NcbiRecord {
  const a = attributes(block);
  const geoValue = pick(a, ['geo_loc_name', 'geographic location', 'country']);
  const collectionDate = pick(a, ['collection_date', 'collection date', 'sample collection date']);
  const organism = tag(block, 'OrganismName') || attr(block, 'taxonomy_name') || pick(a, ['organism', 'scientific name']);
  const accession = attr(block, 'accession') || tag(block, 'Accession') || id(block, /SAM[NED][A-Z]?\d+/);
  const latlonValue = pick(a, ['lat_lon', 'latitude and longitude']);
  const record: NcbiRecord = {
    id: `${sourceFile}-${index}`,
    sourceFile,
    fileType: 'BioSample',
    accession,
    bioSampleAccession: accession,
    taxonomyId: attr(block, 'taxonomy_id') || attr(block, 'taxid') || pick(a, ['taxid', 'taxonomy id']),
    organism,
    scientificName: organism,
    commonName: pick(a, ['common name']),
    bioProjectAccession: tag(block, 'BioProject') || pick(a, ['bioproject']) || id(block, /PRJ[ENDA][A-Z]?\d+/),
    sraAccession: id(block, /SR[APRX]\d+/),
    assemblyAccession: id(block, /GC[AF]_\d+\.\d+/),
    collectionDate,
    collectionYear: year(collectionDate),
    collectionMonth: month(collectionDate),
    host: pick(a, ['host', 'host common name']),
    hostSpecies: pick(a, ['host scientific name', 'host species']),
    isolationSource: pick(a, ['isolation_source', 'isolation source']),
    strain: pick(a, ['strain']),
    isolate: pick(a, ['isolate']),
    serotype: pick(a, ['serotype']),
    serovar: pick(a, ['serovar']),
    sampleType: pick(a, ['sample_type', 'sample type', 'env_broad_scale']),
    laboratory: pick(a, ['lab', 'laboratory', 'collecting lab']),
    institution: pick(a, ['institution']),
    organization: tag(block, 'Organization') || pick(a, ['organization']),
    submitter: tag(block, 'Submitter') || pick(a, ['submitter']),
    submissionDate: attr(block, 'submission_date') || tag(block, 'SubmissionDate'),
    publicationDate: attr(block, 'publication_date') || tag(block, 'PublicationDate'),
    lastUpdateDate: attr(block, 'last_update') || attr(block, 'last_update_date'),
    recordStatus: attr(block, 'status'),
    raw: a,
    ...geo(geoValue),
    ...latlon(latlonValue || geoValue)
  };
  return record;
}

function parseGeneric(block: string, sourceFile: string, index: number, fileType: string): NcbiRecord {
  const a = attributes(block);
  const geoValue = pick(a, ['geo_loc_name', 'country']);
  const collectionDate = pick(a, ['collection_date', 'collection date']);
  const organism = tag(block, 'Organism') || tag(block, 'ScientificName') || tag(block, 'GBSeq_organism') || pick(a, ['organism']);
  return {
    id: `${sourceFile}-${index}`,
    sourceFile,
    fileType,
    accession: tag(block, 'GBSeq_primary-accession') || tag(block, 'AssemblyAccession') || attr(block, 'accession') || id(block, /SAM[NED][A-Z]?\d+|SR[APRX]\d+|GC[AF]_\d+\.\d+/),
    bioSampleAccession: tag(block, 'BioSampleAccn') || tag(block, 'BioSample') || id(block, /SAM[NED][A-Z]?\d+/),
    bioProjectAccession: tag(block, 'BioProjectAccn') || tag(block, 'BioProject') || id(block, /PRJ[ENDA][A-Z]?\d+/),
    sraAccession: id(block, /SR[APRX]\d+/),
    assemblyAccession: tag(block, 'AssemblyAccession') || id(block, /GC[AF]_\d+\.\d+/),
    taxonomyId: tag(block, 'Taxid') || tag(block, 'TAXON_ID') || pick(a, ['taxid']),
    organism,
    scientificName: organism,
    collectionDate,
    collectionYear: year(collectionDate),
    collectionMonth: month(collectionDate),
    host: pick(a, ['host']),
    isolationSource: pick(a, ['isolation_source', 'isolation source']),
    strain: pick(a, ['strain']),
    organization: tag(block, 'CENTER_NAME') || tag(block, 'Submitter'),
    submitter: tag(block, 'Submitter'),
    submissionDate: tag(block, 'SubmissionDate') || tag(block, 'CREATE_DATE'),
    lastUpdateDate: tag(block, 'UPDATE_DATE') || tag(block, 'LastUpdateDate'),
    recordStatus: tag(block, 'Status'),
    raw: a,
    ...geo(geoValue)
  };
}

function parseXml(xml: string, sourceFile: string): NcbiRecord[] {
  const fileType = detect(xml);
  let selected: string[] = [];
  if (fileType === 'BioSample') selected = blocks(xml, 'BioSample');
  if (fileType === 'SRA') selected = [...blocks(xml, 'EXPERIMENT_PACKAGE'), ...blocks(xml, 'Run'), ...blocks(xml, 'SAMPLE')];
  if (fileType === 'Nucleotide/GenBank') selected = blocks(xml, 'GBSeq');
  if (fileType === 'Assembly') selected = [...blocks(xml, 'DocumentSummary'), ...blocks(xml, 'Assembly')];
  if (!selected.length) selected = [xml];

  const records: NcbiRecord[] = [];
  selected.forEach((block, index) => {
    try {
      const record = fileType === 'BioSample'
        ? parseBioSample(block, sourceFile, index)
        : parseGeneric(block, sourceFile, index, fileType);
      if (record.accession || record.bioSampleAccession || record.organism) records.push(record);
    } catch {
      // Skip malformed record chunks while keeping the rest of the file usable.
    }
  });
  return records;
}

function duplicateKey(record: NcbiRecord): string {
  return record.bioSampleAccession || record.accession || [record.bioProjectAccession, record.organism, record.collectionDate].filter(Boolean).join('|') || [record.taxonomyId, record.strain, record.collectionDate].filter(Boolean).join('|') || record.id;
}

self.onmessage = (event: MessageEvent<{ files: UploadFile[] }>) => {
  const records: NcbiRecord[] = [];
  const duplicates: NcbiRecord[] = [];
  const errors: string[] = [];

  for (const file of event.data.files || []) {
    try {
      const parsed = parseXml(file.text, file.name);
      if (!parsed.length) errors.push(`${file.name}: no recognizable NCBI records found`);
      records.push(...parsed);
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const unique = new Map<string, NcbiRecord>();
  for (const record of records) {
    const key = duplicateKey(record);
    if (unique.has(key)) duplicates.push(record);
    else unique.set(key, record);
  }

  const result: ParseResult = { records: [...unique.values()], duplicates, errors };
  postMessage(result);
};
