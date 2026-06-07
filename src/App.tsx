import React from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Activity, Database, Download, Moon, Search, Sun, UploadCloud, Zap } from 'lucide-react';
import type { NcbiRecord, ParseProgress, ParseResult, WorkerMessage } from './types';
import { countBy, downloadBlob, fields, missingRows, present, toCsv, unique } from './utils';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend);

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

const tableFields = ['accession','organism','taxonomyId','bioSampleAccession','bioProjectAccession','collectionDate','country','region','city','host','laboratory','institution','organization','owner','isolationSource','sourceFile'] as (keyof NcbiRecord)[];

function chartData(pairs: [string, number][], label = 'Records') {
  const top = pairs.slice(0, 12);
  return { labels: top.map(p => p[0]), datasets: [{ label, data: top.map(p => p[1]) }] };
}

function snapshotRows(records: NcbiRecord[]): NcbiRecord[] {
  const groups = new Map<string, NcbiRecord[]>();
  for (const record of records) {
    const key = record.sourceFile || 'Unknown';
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.entries()].map(([sourceFile, rows]) => ({
    id: sourceFile,
    sourceFile,
    fileType: 'Snapshot',
    accession: String(rows.length),
    organism: `${new Set(rows.map(r => r.organism).filter(Boolean)).size} organisms`,
    country: `${new Set(rows.map(r => r.country).filter(Boolean)).size} countries`,
    host: `${new Set(rows.map(r => r.host).filter(Boolean)).size} hosts`,
    laboratory: `${new Set(rows.map(r => r.laboratory || r.institution || r.organization).filter(Boolean)).size} labs`,
    owner: `${new Set(rows.map(r => r.owner).filter(Boolean)).size} owners`,
    bioProjectAccession: `${new Set(rows.map(r => r.bioProjectAccession).filter(Boolean)).size} BioProjects`
  }));
}

function hostLabRows(records: NcbiRecord[]) {
  const map = new Map<string, { records: number; labs: Set<string>; owners: Set<string>; countries: Set<string>; organisms: Set<string> }>();
  for (const record of records) {
    const host = record.host || record.hostSpecies || 'Unknown host';
    const lab = record.laboratory || record.institution || record.organization || 'Unknown lab';
    const owner = record.owner || record.submitter || record.organization || 'Unknown owner';
    const entry = map.get(host) || { records: 0, labs: new Set<string>(), owners: new Set<string>(), countries: new Set<string>(), organisms: new Set<string>() };
    entry.records += 1;
    entry.labs.add(lab);
    entry.owners.add(owner);
    if (record.country) entry.countries.add(record.country);
    if (record.organism) entry.organisms.add(record.organism);
    map.set(host, entry);
  }
  return [...map.entries()].map(([host, value]) => ({
    host,
    records: value.records,
    labCount: value.labs.size,
    ownerCount: value.owners.size,
    labs: [...value.labs].sort().slice(0, 30).join('; '),
    owners: [...value.owners].sort().slice(0, 30).join('; '),
    countries: value.countries.size,
    organisms: value.organisms.size
  })).sort((a, b) => b.records - a.records);
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <div className="card"><div className="value">{value}</div><div className="label">{label}</div></div>;
}

function ProgressPanel({ progress }: { progress: ParseProgress | null }) {
  if (!progress) return null;
  return <section className="panel progress-panel">
    <div className="progress-head"><Database className="spin" /> <b>Parsing {progress.fileName}</b><span>File {progress.fileIndex} of {progress.fileCount}</span></div>
    <div className="progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
    <p className="muted">{progress.percent}% complete · {progress.recordsParsed.toLocaleString()} records parsed{progress.largeFileMode ? ' · Large File Mode active' : ''}</p>
  </section>;
}

function VirtualTable({ records, maxHeight = 560 }: { records: NcbiRecord[]; maxHeight?: number }) {
  const rowHeight = 44;
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const visibleCount = Math.ceil(maxHeight / rowHeight) + 10;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const end = Math.min(records.length, start + visibleCount);
  const visible = records.slice(start, end);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    if (headerRef.current) headerRef.current.scrollLeft = target.scrollLeft;
  }

  React.useEffect(() => {
    setScrollTop(0);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (headerRef.current) headerRef.current.scrollLeft = 0;
  }, [records]);

  return <div className="virtual-table">
    <div className="virtual-header-scroll" ref={headerRef} aria-hidden="true">
      <div className="virtual-grid virtual-header">{tableFields.map(f => <div key={f}>{f}</div>)}</div>
    </div>
    <div className="virtual-body" ref={bodyRef} style={{ maxHeight }} onScroll={handleScroll}>
      <div className="virtual-spacer" style={{ height: Math.max(records.length * rowHeight, rowHeight) }}>
        {visible.map((record, i) => <div className="virtual-grid virtual-row" key={record.id || start + i} style={{ transform: `translateY(${(start + i) * rowHeight}px)` }}>
          {tableFields.map(f => <div key={f} title={String(record[f] || '')}>{String(record[f] || '')}</div>)}
        </div>)}
      </div>
    </div>
  </div>;
}

function HostLabTable({ rows }: { rows: ReturnType<typeof hostLabRows> }) {
  return <div className="table-wrap"><table className="wide-table"><thead><tr><th>Host</th><th>Records</th><th>Lab count</th><th>Owner count</th><th>Lab names</th><th>Owners</th><th>Countries</th><th>Organisms</th></tr></thead><tbody>{rows.slice(0, 500).map(row => <tr key={row.host}><td>{row.host}</td><td>{row.records.toLocaleString()}</td><td>{row.labCount}</td><td>{row.ownerCount}</td><td>{row.labs}</td><td>{row.owners}</td><td>{row.countries}</td><td>{row.organisms}</td></tr>)}</tbody></table></div>;
}

export default function App() {
  const [records, setRecords] = React.useState<NcbiRecord[]>([]);
  const [filtered, setFiltered] = React.useState<NcbiRecord[]>([]);
  const [duplicates, setDuplicates] = React.useState<NcbiRecord[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [largeFileMode, setLargeFileMode] = React.useState(false);
  const [progress, setProgress] = React.useState<ParseProgress | null>(null);
  const [dark, setDark] = React.useState(localStorage.theme === 'dark');
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState({ organism: '', country: '', host: '', year: '' });

  React.useEffect(() => {
    document.body.className = dark ? 'dark' : 'light';
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);

  React.useEffect(() => {
    const q = query.toLowerCase();
    const next = records.filter(record => {
      const matchesSearch = !q || fields.some(field => String(record[field] || '').toLowerCase().includes(q));
      const matchesFilters = (!filters.organism || record.organism === filters.organism)
        && (!filters.country || record.country === filters.country)
        && (!filters.host || record.host === filters.host)
        && (!filters.year || record.collectionYear === filters.year);
      return matchesSearch && matchesFilters;
    });
    setFiltered(next);
  }, [query, filters, records]);

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    setLoading(true);
    setErrors([]);
    setProgress(null);
    setLargeFileMode(files.some(file => file.size > 25 * 1024 * 1024));
    const worker = new Worker(new URL('./workers/parserWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if ('type' in event.data && event.data.type === 'progress') {
        setProgress(event.data);
        if (event.data.largeFileMode) setLargeFileMode(true);
        return;
      }
      const result = event.data as ParseResult;
      setRecords(result.records);
      setFiltered(result.records);
      setDuplicates(result.duplicates);
      setErrors(result.errors);
      setLargeFileMode(Boolean(result.largeFileMode) || result.records.length >= 50000);
      setLoading(false);
      setProgress(null);
      worker.terminate();
    };
    worker.onerror = event => {
      setErrors([event.message]);
      setLoading(false);
      setProgress(null);
      worker.terminate();
    };
    worker.postMessage({ files });
  }

  const missing = missingRows(records);
  const completionFields: (keyof NcbiRecord)[] = ['collectionDate', 'country', 'host', 'laboratory', 'owner', 'bioProjectAccession', 'bioSampleAccession'];
  const completeness = records.length ? Math.round(completionFields.reduce((sum, field) => sum + present(records, field) / records.length, 0) / completionFields.length * 100) : 0;
  const organisms = countBy(records, 'organism');
  const countries = countBy(records, 'country');
  const years = countBy(records, 'collectionYear').sort((a, b) => a[0].localeCompare(b[0]));
  const hosts = countBy(records, 'host');
  const projects = countBy(records, 'bioProjectAccession');
  const labs = countBy(records, 'laboratory');
  const owners = countBy(records, 'owner');
  const hostLabs = hostLabRows(records);
  const coords = records.filter(r => r.latitude && r.longitude && !Number.isNaN(Number(r.latitude)) && !Number.isNaN(Number(r.longitude)));

  function exportXlsx(data: NcbiRecord[], name: string) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Records');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hostLabs), 'Host_Labs');
    XLSX.writeFile(wb, name);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.text('NCBI XML BioSurveillance Dashboard Report', 14, 14);
    autoTable(doc, {
      startY: 22,
      head: [['Metric', 'Value']],
      body: [
        ['Total Records', String(records.length)],
        ['Unique Organisms', String(unique(records, 'organism'))],
        ['Unique Countries', String(unique(records, 'country'))],
        ['Unique Owners', String(unique(records, 'owner'))],
        ['Metadata Completeness', `${completeness}%`],
        ['Missing Metadata Records', String(missing.length)],
        ['Duplicates', String(duplicates.length)],
        ['Large File Mode', largeFileMode ? 'Enabled' : 'Not needed']
      ]
    });
    autoTable(doc, {
      head: [['Host', 'Records', 'Lab Count', 'Owner Count', 'Labs', 'Owners']],
      body: hostLabs.slice(0, 30).map(r => [r.host, String(r.records), String(r.labCount), String(r.ownerCount), r.labs, r.owners])
    });
    doc.save('ncbi-dashboard-report.pdf');
  }

  const filterOptions = {
    organism: countBy(records, 'organism').filter(([v]) => v !== 'Unknown'),
    country: countBy(records, 'country').filter(([v]) => v !== 'Unknown'),
    host: countBy(records, 'host').filter(([v]) => v !== 'Unknown'),
    year: countBy(records, 'collectionYear').filter(([v]) => v !== 'Unknown')
  };

  return <main>
    <header className="hero">
      <div>
        <div className="brand"><Activity /> NCBI XML BioSurveillance Dashboard</div>
        <h1>Browser-only NCBI XML metadata surveillance</h1>
        <p>Upload BioSample, Assembly, SRA, or GenBank XML files. V2 adds large-file streaming, progress tracking, virtualized exploration, owner extraction, and host-to-laboratory intelligence.</p>
        <div className="badges"><span>GitHub Pages ready</span><span>Streaming parser</span><span>Large File Mode</span><span>Virtualized 250K+ table</span><span>Owner attributes</span><span>Host → Labs</span></div>
      </div>
      <button className="theme" onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />} {dark ? 'Light' : 'Dark'}</button>
    </header>

    <section className="panel upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
      <UploadCloud size={44} />
      <h2>Upload XML files</h2>
      <p>Drag and drop one or more XML files exported manually from NCBI. Large BioSample XML files are streamed in chunks.</p>
      <label className="button"><input type="file" accept=".xml,text/xml" multiple onChange={e => e.target.files && handleFiles(e.target.files)} /> Choose XML files</label>
    </section>

    {loading && <ProgressPanel progress={progress} />}
    {largeFileMode && <section className="panel large-mode"><Zap /> <div><b>Large File Mode</b><p className="muted">Optimized rendering is active. Charts and maps use capped visual samples while exports keep the full parsed dataset.</p></div></section>}
    {errors.length > 0 && <section className="panel warn"><b>Some files need review</b>{errors.slice(0, 20).map(e => <p key={e}>{e}</p>)}</section>}

    {records.length > 0 && <>
      <nav className="tabs"><a href="#summary">Summary</a><a href="#quality">Quality</a><a href="#charts">Charts</a><a href="#map">Map</a><a href="#explorer">Explorer</a><a href="#hostlabs">Host Labs</a><a href="#monitoring">Monitoring</a><a href="#exports">Exports</a></nav>

      <section id="summary" className="cards">
        <SummaryCard label="Total Records" value={records.length.toLocaleString()} />
        <SummaryCard label="Unique Organisms" value={unique(records, 'organism')} />
        <SummaryCard label="Unique Taxonomy IDs" value={unique(records, 'taxonomyId')} />
        <SummaryCard label="Unique Countries" value={unique(records, 'country')} />
        <SummaryCard label="Unique Hosts" value={unique(records, 'host')} />
        <SummaryCard label="Unique BioProjects" value={unique(records, 'bioProjectAccession')} />
        <SummaryCard label="Unique Laboratories" value={unique(records, 'laboratory')} />
        <SummaryCard label="Unique Owners" value={unique(records, 'owner')} />
        <SummaryCard label="With Collection Date" value={present(records, 'collectionDate').toLocaleString()} />
        <SummaryCard label="With Lab Name" value={present(records, 'laboratory').toLocaleString()} />
        <SummaryCard label="With Owner" value={present(records, 'owner').toLocaleString()} />
        <SummaryCard label="Missing Metadata" value={missing.length.toLocaleString()} />
      </section>

      <section id="quality" className="panel">
        <h2>Data Quality Dashboard</h2>
        <div className="quality-grid">
          <SummaryCard label="Completeness Score" value={`${completeness}%`} />
          <SummaryCard label="Missing Collection Date" value={(records.length - present(records, 'collectionDate')).toLocaleString()} />
          <SummaryCard label="Missing Country" value={(records.length - present(records, 'country')).toLocaleString()} />
          <SummaryCard label="Missing Host" value={(records.length - present(records, 'host')).toLocaleString()} />
          <SummaryCard label="Missing Laboratory" value={(records.length - present(records, 'laboratory')).toLocaleString()} />
          <SummaryCard label="Missing Owner" value={(records.length - present(records, 'owner')).toLocaleString()} />
          <SummaryCard label="Missing BioProject" value={(records.length - present(records, 'bioProjectAccession')).toLocaleString()} />
        </div>
        <h3>Records requiring curation</h3>
        <VirtualTable records={missing} maxHeight={420} />
      </section>

      {!largeFileMode && <section id="charts" className="charts">
        <section className="panel"><h3>Top Organisms</h3><Bar data={chartData(organisms)} /></section>
        <section className="panel"><h3>Countries by Record Count</h3><Bar data={chartData(countries)} /></section>
        <section className="panel"><h3>Collection Year Distribution</h3><Line data={chartData(years)} /></section>
        <section className="panel"><h3>Host Distribution</h3><Doughnut data={chartData(hosts)} /></section>
        <section className="panel"><h3>BioProject Distribution</h3><Bar data={chartData(projects)} /></section>
        <section className="panel"><h3>Laboratory Distribution</h3><Bar data={chartData(labs)} /></section>
        <section className="panel"><h3>Owner Distribution</h3><Bar data={chartData(owners)} /></section>
      </section>}

      <section id="map" className="panel map-panel">
        <h2>Geographic Map</h2>
        {coords.length ? <MapContainer center={[20, 0]} zoom={2} scrollWheelZoom className="map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {coords.slice(0, largeFileMode ? 1000 : 2000).map((r, i) => <Marker key={`${r.id}-${i}`} position={[Number(r.latitude), Number(r.longitude)]} icon={markerIcon}><Popup><b>{r.organism || r.accession}</b><br />{r.country || ''}<br />{r.host || ''}<br />{r.laboratory || r.institution || r.organization || ''}<br />Owner: {r.owner || ''}<br />{r.collectionDate || ''}</Popup></Marker>)}
        </MapContainer> : <p className="muted">No latitude/longitude coordinates found. Country-level summaries are still available in charts and table.</p>}
      </section>

      <section id="explorer" className="panel">
        <h2>Advanced Table Explorer</h2>
        <div className="toolbar">
          <div className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all columns including owner" /></div>
          <select value={filters.organism} onChange={e => setFilters({ ...filters, organism: e.target.value })}><option value="">All organisms</option>{filterOptions.organism.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.country} onChange={e => setFilters({ ...filters, country: e.target.value })}><option value="">All countries</option>{filterOptions.country.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.host} onChange={e => setFilters({ ...filters, host: e.target.value })}><option value="">All hosts</option>{filterOptions.host.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })}><option value="">All years</option>{filterOptions.year.map(([v]) => <option key={v}>{v}</option>)}</select>
        </div>
        <p className="muted">Showing {filtered.length.toLocaleString()} filtered records using virtualized rendering. The Explorer includes the owner field extracted from XML attributes/tags when available.</p>
        <VirtualTable records={filtered} />
      </section>

      <section id="hostlabs" className="panel">
        <h2>Host → Laboratory Intelligence</h2>
        <p className="muted">Each host is summarized with the number of records, lab names, and owners detected from XML owner/contact/submitter/organization fields.</p>
        <HostLabTable rows={hostLabs} />
      </section>

      <section id="monitoring" className="panel">
        <h2>Daily Monitoring / Multi-file Comparison</h2>
        <VirtualTable records={snapshotRows(records)} maxHeight={280} />
      </section>

      <section className="panel">
        <h2>Duplicates and Orphans</h2>
        <p><b>{duplicates.length.toLocaleString()}</b> possible duplicates detected.</p>
        <p><b>{missing.length.toLocaleString()}</b> orphan / incomplete records detected.</p>
      </section>

      <section id="exports" className="panel exports">
        <h2>Export Reports</h2>
        <button className="button" onClick={() => downloadBlob(toCsv(records), 'full_dataset.csv', 'text/csv')}><Download /> Full CSV</button>
        <button className="button" onClick={() => downloadBlob(toCsv(filtered), 'filtered_dataset.csv', 'text/csv')}><Download /> Filtered CSV</button>
        <button className="button" onClick={() => exportXlsx(records, 'full_dataset.xlsx')}><Download /> Excel + Host Labs</button>
        <button className="button" onClick={exportPdf}><Download /> PDF Summary</button>
      </section>
    </>}

    <footer>Static GitHub Pages application. All XML processing happens locally in your browser.</footer>
  </main>;
}
