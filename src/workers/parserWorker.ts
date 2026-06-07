import type { NcbiRecord, ParseProgress, ParseResult } from '../types';

type UploadFile = File | { name: string; text: string; size?: number };

const LARGE_FILE_BYTES = 25 * 1024 * 1024;
const LARGE_FILE_RECORDS = 50000;

function clean(value?: string | null): string | undefined {
  const out = (value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  if (!out || ['missing', 'not provided', 'not collected', 'unknown', 'na', 'n/a'].includes(out.toLowerCase())) return undefined;
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

function completeBlocks(buffer: string, name: string): { items: string[]; rest: string } {
  const re = new RegExp(`<(?:[A-Za-z0-9_\\-]+:)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z0-9_\\-]+:)?${name}>`, 'gi');
  const items: string[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(buffer))) {
    items.push(match[0]);
    lastEnd = re.lastIndex;
  }
  return { items, rest: lastEnd ? buffer.slice(lastEnd) : buffer };
}

function attributes(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<(?:[A-Za-z0-9_\-]+:)?Attribute\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_\-]+:)?Attribute>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    const key = attr(match[1], 'harmonized_name') || attr(match[1], 'attribute_name') || attr(match[1], 'display_name') || attr(match[1], 'name');
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
  const collectionDate = pick(a, ['collection_date', 'collection date', 'sample collection date', 'date collected']);
  const organism = tag(block, 'OrganismName') || attr(block, 'taxonomy_name') || pick(a, ['organism', 'scientific name']);
  const accession = attr(block, 'accession') || tag(block, 'Accession') || id(block, /SAM[NED][A-Z]?\d+/);
  const latlonValue = pick(a, ['lat_lon', 'latitude and longitude', 'lat lon']);
  const laboratory = pick(a, ['lab', 'laboratory', 'collecting lab', 'collected by', 'sequencing center', 'center name', 'submitter lab']);
  const organization = tag(block, 'Organization') || pick(a, ['organization', 'submitter organization', 'center name']);
  return {
    id: `${sourceFile}-${index}`,
    sourceFile,
    fileType: 'BioSample',
    accession,
    bioSampleAccession: accession,
    taxonomyId: attr(block, 'taxonomy_id') || attr(block, 'taxid') || pick(a, ['taxid', 'taxonomy id']),
    organism,
    scientificName: organism,
    commonName: pick(a, ['common name']),
    bioProjectAccession: tag(block, 'BioProject') || pick(a, ['bioproject', 'bioproject accession']) || id(block, /PRJ[ENDA][A-Z]?\d+/),
    sraAccession: id(block, /SR[APRX]\d+/),
    assemblyAccession: id(block, /GC[AF]_\d+\.\d+/),
    collectionDate,
    collectionYear: year(collectionDate),
    collectionMonth: month(collectionDate),
    host: pick(a, ['host', 'host common name', 'host name']),
    hostSpecies: pick(a, ['host scientific name', 'host species']),
    isolationSource: pick(a, ['isolation_source', 'isolation source']),
    strain: pick(a, ['strain']),
    isolate: pick(a, ['isolate']),
    serotype: pick(a, ['serotype']),
    serovar: pick(a, ['serovar']),
    sampleType: pick(a, ['sample_type', 'sample type', 'env_broad_scale']),
    laboratory,
    institution: pick(a, ['institution', 'institute', 'affiliation']),
    organization,
    submitter: tag(block, 'Submitter') || pick(a, ['submitter']),
    submissionDate: attr(block, 'submission_date') || tag(block, 'SubmissionDate'),
    publicationDate: attr(block, 'publication_date') || tag(block, 'PublicationDate'),
    lastUpdateDate: attr(block, 'last_update') || attr(block, 'last_update_date'),
    recordStatus: attr(block, 'status'),
    raw: a,
    ...geo(geoValue),
    ...latlon(latlonValue || geoValue)
  };
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
    laboratory: pick(a, ['lab', 'laboratory', 'collecting lab', 'sequencing center', 'center name']),
    organization: tag(block, 'CENTER_NAME') || tag(block, 'Submitter') || pick(a, ['organization']),
    submitter: tag(block, 'Submitter'),
    submissionDate: tag(block, 'SubmissionDate') || tag(block, 'CREATE_DATE'),
    lastUpdateDate: tag(block, 'UPDATE_DATE') || tag(block, 'LastUpdateDate'),
    recordStatus: tag(block, 'Status'),
    raw: a,
    ...geo(geoValue)
  };
}

function parseBlocks(xml: string, sourceFile: string): NcbiRecord[] {
  const fileType = detect(xml);
  let selected: string[] = [];
  if (fileType === 'BioSample') selected = blocks(xml, 'BioSample');
  if (fileType === 'SRA') selected = [...blocks(xml, 'EXPERIMENT_PACKAGE'), ...blocks(xml, 'Run'), ...blocks(xml, 'SAMPLE')];
  if (fileType === 'Nucleotide/GenBank') selected = blocks(xml, 'GBSeq');
  if (fileType === 'Assembly') selected = [...blocks(xml, 'DocumentSummary'), ...blocks(xml, 'Assembly')];
  if (!selected.length) selected = [xml];
  return selected.map((block, index) => fileType === 'BioSample' ? parseBioSample(block, sourceFile, index) : parseGeneric(block, sourceFile, index, fileType)).filter(r => r.accession || r.bioSampleAccession || r.organism);
}

function duplicateKey(record: NcbiRecord): string {
  return record.bioSampleAccession || record.accession || [record.bioProjectAccession, record.organism, record.collectionDate].filter(Boolean).join('|') || [record.taxonomyId, record.strain, record.collectionDate].filter(Boolean).join('|') || record.id;
}

function sendProgress(progress: ParseProgress) {
  postMessage(progress);
}

async function parseUpload(file: UploadFile, fileIndex: number, fileCount: number): Promise<{ records: NcbiRecord[]; errors: string[]; largeFileMode: boolean }> {
  const name = file.name;
  const size = 'size' in file && file.size ? file.size : ('text' in file ? file.text.length : 0);
  const largeFileMode = size >= LARGE_FILE_BYTES;
  const records: NcbiRecord[] = [];
  const errors: string[] = [];

  if ('stream' in file && typeof file.stream === 'function') {
    const decoder = new TextDecoder();
    const reader = file.stream().getReader();
    let loadedBytes = 0;
    let buffer = '';
    let fileType = '';
    let genericXml = '';
    let index = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      if (!fileType && buffer.length > 5000) fileType = detect(buffer);

      if (fileType === 'BioSample') {
        const pulled = completeBlocks(buffer, 'BioSample');
        buffer = pulled.rest;
        for (const block of pulled.items) {
          try {
            const record = parseBioSample(block, name, index++);
            if (record.accession || record.bioSampleAccession || record.organism) records.push(record);
          } catch {
            errors.push(`${name}: skipped malformed BioSample chunk near record ${index}`);
          }
        }
      } else if (largeFileMode) {
        genericXml += chunk;
      }

      sendProgress({ type: 'progress', fileName: name, fileIndex, fileCount, loadedBytes, totalBytes: size, recordsParsed: records.length, percent: size ? Math.min(99, Math.round((loadedBytes / size) * 100)) : 0, largeFileMode });
    }

    buffer += decoder.decode();
    fileType = fileType || detect(buffer || genericXml);
    if (fileType === 'BioSample') {
      const tail = completeBlocks(buffer, 'BioSample');
      for (const block of tail.items) {
        const record = parseBioSample(block, name, index++);
        if (record.accession || record.bioSampleAccession || record.organism) records.push(record);
      }
    } else {
      records.push(...parseBlocks(genericXml || buffer, name));
    }

    sendProgress({ type: 'progress', fileName: name, fileIndex, fileCount, loadedBytes: size, totalBytes: size, recordsParsed: records.length, percent: 100, largeFileMode: largeFileMode || records.length >= LARGE_FILE_RECORDS });
    if (!records.length) errors.push(`${name}: no recognizable NCBI records found`);
    return { records, errors, largeFileMode: largeFileMode || records.length >= LARGE_FILE_RECORDS };
  }

  const text = 'text' in file ? file.text : '';
  records.push(...parseBlocks(text, name));
  if (!records.length) errors.push(`${name}: no recognizable NCBI records found`);
  return { records, errors, largeFileMode: largeFileMode || records.length >= LARGE_FILE_RECORDS };
}

self.onmessage = async (event: MessageEvent<{ files: UploadFile[] }>) => {
  const records: NcbiRecord[] = [];
  const duplicates: NcbiRecord[] = [];
  const errors: string[] = [];
  let largeFileMode = false;

  for (let i = 0; i < (event.data.files || []).length; i++) {
    try {
      const parsed = await parseUpload(event.data.files[i], i + 1, event.data.files.length);
      records.push(...parsed.records);
      errors.push(...parsed.errors);
      largeFileMode = largeFileMode || parsed.largeFileMode;
    } catch (error) {
      errors.push(`${event.data.files[i]?.name || 'file'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const unique = new Map<string, NcbiRecord>();
  for (const record of records) {
    const key = duplicateKey(record);
    if (unique.has(key)) duplicates.push(record);
    else unique.set(key, record);
  }

  const result: ParseResult = { type: 'done', records: [...unique.values()], duplicates, errors, largeFileMode: largeFileMode || records.length >= LARGE_FILE_RECORDS };
  postMessage(result);
};
