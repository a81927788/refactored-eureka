export type NcbiRecord = {
  id: string;
  sourceFile: string;
  fileType: string;
  accession?: string;
  taxonomyId?: string;
  organism?: string;
  scientificName?: string;
  commonName?: string;
  bioSampleAccession?: string;
  bioProjectAccession?: string;
  sraAccession?: string;
  assemblyAccession?: string;
  collectionDate?: string;
  collectionYear?: string;
  collectionMonth?: string;
  country?: string;
  region?: string;
  city?: string;
  geoLocation?: string;
  latitude?: string;
  longitude?: string;
  host?: string;
  hostSpecies?: string;
  isolationSource?: string;
  strain?: string;
  isolate?: string;
  serotype?: string;
  serovar?: string;
  sampleType?: string;
  laboratory?: string;
  institution?: string;
  organization?: string;
  owner?: string;
  submitter?: string;
  submissionDate?: string;
  publicationDate?: string;
  lastUpdateDate?: string;
  recordStatus?: string;
  raw?: Record<string, string>;
};

export type ParseProgress = {
  type: 'progress';
  fileName: string;
  fileIndex: number;
  fileCount: number;
  loadedBytes: number;
  totalBytes: number;
  recordsParsed: number;
  percent: number;
  largeFileMode: boolean;
};

export type ParseResult = {
  type?: 'done';
  records: NcbiRecord[];
  duplicates: NcbiRecord[];
  errors: string[];
  largeFileMode?: boolean;
};

export type WorkerMessage = ParseProgress | ParseResult;
