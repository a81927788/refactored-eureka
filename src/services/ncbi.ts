export type NcbiDatabase = 'biosample' | 'assembly';

export type NcbiCountResult = {
  db: NcbiDatabase;
  count: number;
  error?: string;
};

export type NcbiRetrieveOptions = {
  taxid: string;
  includeSubTaxa: boolean;
  databases: NcbiDatabase[];
  maxRecords: number;
  batchSize: number;
  email?: string;
  apiKey?: string;
  onProgress?: (message: string, percent: number) => void;
};

export type RetrievedXmlFile = {
  name: string;
  text: string;
  size: number;
};

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TOOL = 'ncbi_xml_biosurveillance_dashboard';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function queryForTaxId(taxid: string, includeSubTaxa: boolean) {
  const cleanTaxid = taxid.trim();
  return includeSubTaxa ? `txid${cleanTaxid}[Organism:exp]` : `txid${cleanTaxid}[Organism]`;
}

function commonParams(email?: string, apiKey?: string) {
  const params = new URLSearchParams({ tool: TOOL });
  if (email?.trim()) params.set('email', email.trim());
  if (apiKey?.trim()) params.set('api_key', apiKey.trim());
  return params;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

export async function checkNcbiCounts(taxid: string, includeSubTaxa: boolean, databases: NcbiDatabase[], email?: string, apiKey?: string): Promise<NcbiCountResult[]> {
  const term = queryForTaxId(taxid, includeSubTaxa);
  const results: NcbiCountResult[] = [];

  for (const db of databases) {
    try {
      const params = commonParams(email, apiKey);
      params.set('db', db);
      params.set('term', term);
      params.set('retmode', 'json');
      params.set('retmax', '0');
      const data = await fetchJson<{ esearchresult?: { count?: string } }>(`${EUTILS}/esearch.fcgi?${params.toString()}`);
      results.push({ db, count: Number(data.esearchresult?.count || 0) });
    } catch (error) {
      results.push({ db, count: 0, error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(350);
  }

  return results;
}

async function fetchIds(db: NcbiDatabase, taxid: string, includeSubTaxa: boolean, maxRecords: number, email?: string, apiKey?: string): Promise<string[]> {
  const params = commonParams(email, apiKey);
  params.set('db', db);
  params.set('term', queryForTaxId(taxid, includeSubTaxa));
  params.set('retmode', 'json');
  params.set('retmax', String(maxRecords));
  const data = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(`${EUTILS}/esearch.fcgi?${params.toString()}`);
  return data.esearchresult?.idlist || [];
}

async function fetchXmlBatch(db: NcbiDatabase, ids: string[], email?: string, apiKey?: string): Promise<string> {
  const params = commonParams(email, apiKey);
  params.set('db', db);
  params.set('id', ids.join(','));
  params.set('retmode', 'xml');
  if (db === 'assembly') {
    return fetchText(`${EUTILS}/esummary.fcgi?${params.toString()}`);
  }
  return fetchText(`${EUTILS}/efetch.fcgi?${params.toString()}`);
}

export async function retrieveNcbiXmlFiles(options: NcbiRetrieveOptions): Promise<RetrievedXmlFile[]> {
  const maxRecords = Math.max(1, Math.min(options.maxRecords || 1000, 10000));
  const batchSize = Math.max(20, Math.min(options.batchSize || 200, 500));
  const files: RetrievedXmlFile[] = [];
  const totalStages = options.databases.length;

  for (let dbIndex = 0; dbIndex < options.databases.length; dbIndex += 1) {
    const db = options.databases[dbIndex];
    options.onProgress?.(`Searching ${db} IDs`, Math.round((dbIndex / totalStages) * 100));
    const ids = await fetchIds(db, options.taxid, options.includeSubTaxa, maxRecords, options.email, options.apiKey);
    const limited = ids.slice(0, maxRecords);
    const xmlParts: string[] = [];

    for (let start = 0; start < limited.length; start += batchSize) {
      const batch = limited.slice(start, start + batchSize);
      const xml = await fetchXmlBatch(db, batch, options.email, options.apiKey);
      xmlParts.push(xml);
      const dbProgress = limited.length ? (start + batch.length) / limited.length : 1;
      const totalProgress = ((dbIndex + dbProgress) / totalStages) * 100;
      options.onProgress?.(`Retrieving ${db}: ${Math.min(start + batch.length, limited.length).toLocaleString()} / ${limited.length.toLocaleString()}`, Math.round(totalProgress));
      await sleep(options.apiKey ? 150 : 400);
    }

    const text = xmlParts.join('\n');
    files.push({
      name: `ncbi_${db}_txid${options.taxid}_${limited.length}_records.xml`,
      text,
      size: new Blob([text]).size
    });
  }

  options.onProgress?.('NCBI retrieval complete. Parsing XML...', 100);
  return files;
}
