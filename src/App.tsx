import React from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Activity, Database, Download, Moon, Search, Sun, UploadCloud } from 'lucide-react';
import type { NcbiRecord, ParseResult } from './types';
import { countBy, downloadBlob, fields, missingRows, present, toCsv, unique } from './utils';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Tooltip, Legend);

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

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
    bioProjectAccession: `${new Set(rows.map(r => r.bioProjectAccession).filter(Boolean)).size} BioProjects`
  }));
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return <div className="card"><div className="value">{value}</div><div className="label">{label}</div></div>;
}

function Table({ records }: { records: NcbiRecord[] }) {
  const show = ['accession','organism','taxonomyId','bioSampleAccession','bioProjectAccession','collectionDate','country','region','city','host','isolationSource','laboratory','sourceFile'] as (keyof NcbiRecord)[];
  return <div className="table-wrap"><table><thead><tr>{show.map(f => <th key={f}>{f}</th>)}</tr></thead><tbody>{records.slice(0, 1000).map((r, i) => <tr key={r.id || i}>{show.map(f => <td key={f}>{String(r[f] || '')}</td>)}</tr>)}</tbody></table></div>;
}

export default function App() {
  const [records, setRecords] = React.useState<NcbiRecord[]>([]);
  const [filtered, setFiltered] = React.useState<NcbiRecord[]>([]);
  const [duplicates, setDuplicates] = React.useState<NcbiRecord[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
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
    const files = await Promise.all(Array.from(fileList).map(async file => ({ name: file.name, text: await file.text() })));
    setLoading(true);
    setErrors([]);
    const worker = new Worker(new URL('./workers/parserWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ParseResult>) => {
      setRecords(event.data.records);
      setFiltered(event.data.records);
      setDuplicates(event.data.duplicates);
      setErrors(event.data.errors);
      setLoading(false);
      worker.terminate();
    };
    worker.onerror = event => {
      setErrors([event.message]);
      setLoading(false);
      worker.terminate();
    };
    worker.postMessage({ files });
  }

  const missing = missingRows(records);
  const completionFields: (keyof NcbiRecord)[] = ['collectionDate', 'country', 'host', 'laboratory', 'bioProjectAccession', 'bioSampleAccession'];
  const completeness = records.length ? Math.round(completionFields.reduce((sum, field) => sum + present(records, field) / records.length, 0) / completionFields.length * 100) : 0;
  const organisms = countBy(records, 'organism');
  const countries = countBy(records, 'country');
  const years = countBy(records, 'collectionYear').sort((a, b) => a[0].localeCompare(b[0]));
  const hosts = countBy(records, 'host');
  const projects = countBy(records, 'bioProjectAccession');
  const labs = countBy(records, 'laboratory');
  const coords = records.filter(r => r.latitude && r.longitude && !Number.isNaN(Number(r.latitude)) && !Number.isNaN(Number(r.longitude)));

  function exportXlsx(data: NcbiRecord[], name: string) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Records');
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
        ['Metadata Completeness', `${completeness}%`],
        ['Missing Metadata Records', String(missing.length)],
        ['Duplicates', String(duplicates.length)]
      ]
    });
    autoTable(doc, {
      head: [['Accession', 'Organism', 'Country', 'Host', 'Collection Date', 'BioProject']],
      body: filtered.slice(0, 100).map(r => [r.accession || '', r.organism || '', r.country || '', r.host || '', r.collectionDate || '', r.bioProjectAccession || ''])
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
        <p>Upload BioSample, Assembly, SRA, or GenBank XML files. Parse locally, normalize metadata, compare snapshots, detect quality gaps, and export reports. No backend, database, API key, or cloud storage.</p>
        <div className="badges"><span>GitHub Pages ready</span><span>Web Worker parsing</span><span>No DOMParser in Worker</span><span>CSV / XLSX / PDF exports</span></div>
      </div>
      <button className="theme" onClick={() => setDark(!dark)}>{dark ? <Sun /> : <Moon />} {dark ? 'Light' : 'Dark'}</button>
    </header>

    <section className="panel upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
      <UploadCloud size={44} />
      <h2>Upload XML files</h2>
      <p>Drag and drop one or more XML files exported manually from NCBI.</p>
      <label className="button"><input type="file" accept=".xml,text/xml" multiple onChange={e => e.target.files && handleFiles(e.target.files)} /> Choose XML files</label>
    </section>

    {loading && <section className="panel loading"><Database className="spin" /> Parsing XML locally in a Web Worker...</section>}
    {errors.length > 0 && <section className="panel warn"><b>Some files need review</b>{errors.map(e => <p key={e}>{e}</p>)}</section>}

    {records.length > 0 && <>
      <nav className="tabs"><a href="#summary">Summary</a><a href="#quality">Quality</a><a href="#charts">Charts</a><a href="#map">Map</a><a href="#explorer">Explorer</a><a href="#monitoring">Monitoring</a><a href="#exports">Exports</a></nav>

      <section id="summary" className="cards">
        <SummaryCard label="Total Records" value={records.length} />
        <SummaryCard label="Unique Organisms" value={unique(records, 'organism')} />
        <SummaryCard label="Unique Taxonomy IDs" value={unique(records, 'taxonomyId')} />
        <SummaryCard label="Unique Countries" value={unique(records, 'country')} />
        <SummaryCard label="Unique Hosts" value={unique(records, 'host')} />
        <SummaryCard label="Unique BioProjects" value={unique(records, 'bioProjectAccession')} />
        <SummaryCard label="Unique Laboratories" value={unique(records, 'laboratory')} />
        <SummaryCard label="With Collection Date" value={present(records, 'collectionDate')} />
        <SummaryCard label="With Country" value={present(records, 'country')} />
        <SummaryCard label="Missing Metadata" value={missing.length} />
      </section>

      <section id="quality" className="panel">
        <h2>Data Quality Dashboard</h2>
        <div className="quality-grid">
          <SummaryCard label="Completeness Score" value={`${completeness}%`} />
          <SummaryCard label="Missing Collection Date" value={records.length - present(records, 'collectionDate')} />
          <SummaryCard label="Missing Country" value={records.length - present(records, 'country')} />
          <SummaryCard label="Missing Host" value={records.length - present(records, 'host')} />
          <SummaryCard label="Missing Laboratory" value={records.length - present(records, 'laboratory')} />
          <SummaryCard label="Missing BioProject" value={records.length - present(records, 'bioProjectAccession')} />
        </div>
        <h3>Records requiring curation</h3>
        <Table records={missing} />
      </section>

      <section id="charts" className="charts">
        <section className="panel"><h3>Top Organisms</h3><Bar data={chartData(organisms)} /></section>
        <section className="panel"><h3>Countries by Record Count</h3><Bar data={chartData(countries)} /></section>
        <section className="panel"><h3>Collection Year Distribution</h3><Line data={chartData(years)} /></section>
        <section className="panel"><h3>Host Distribution</h3><Doughnut data={chartData(hosts)} /></section>
        <section className="panel"><h3>BioProject Distribution</h3><Bar data={chartData(projects)} /></section>
        <section className="panel"><h3>Laboratory Distribution</h3><Bar data={chartData(labs)} /></section>
      </section>

      <section id="map" className="panel map-panel">
        <h2>Geographic Map</h2>
        {coords.length ? <MapContainer center={[20, 0]} zoom={2} scrollWheelZoom className="map">
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {coords.slice(0, 2000).map((r, i) => <Marker key={`${r.id}-${i}`} position={[Number(r.latitude), Number(r.longitude)]} icon={markerIcon}><Popup><b>{r.organism || r.accession}</b><br />{r.country || ''}<br />{r.collectionDate || ''}</Popup></Marker>)}
        </MapContainer> : <p className="muted">No latitude/longitude coordinates found. Country-level summaries are still available in charts and table.</p>}
      </section>

      <section id="explorer" className="panel">
        <h2>Advanced Table Explorer</h2>
        <div className="toolbar">
          <div className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all columns" /></div>
          <select value={filters.organism} onChange={e => setFilters({ ...filters, organism: e.target.value })}><option value="">All organisms</option>{filterOptions.organism.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.country} onChange={e => setFilters({ ...filters, country: e.target.value })}><option value="">All countries</option>{filterOptions.country.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.host} onChange={e => setFilters({ ...filters, host: e.target.value })}><option value="">All hosts</option>{filterOptions.host.map(([v]) => <option key={v}>{v}</option>)}</select>
          <select value={filters.year} onChange={e => setFilters({ ...filters, year: e.target.value })}><option value="">All years</option>{filterOptions.year.map(([v]) => <option key={v}>{v}</option>)}</select>
        </div>
        <p className="muted">Showing {Math.min(filtered.length, 1000)} of {filtered.length} filtered records.</p>
        <Table records={filtered} />
      </section>

      <section id="monitoring" className="panel">
        <h2>Daily Monitoring / Multi-file Comparison</h2>
        <Table records={snapshotRows(records)} />
      </section>

      <section className="panel">
        <h2>Duplicates and Orphans</h2>
        <p><b>{duplicates.length}</b> possible duplicates detected.</p>
        <p><b>{missing.length}</b> orphan / incomplete records detected.</p>
      </section>

      <section id="exports" className="panel exports">
        <h2>Export Reports</h2>
        <button className="button" onClick={() => downloadBlob(toCsv(records), 'full_dataset.csv', 'text/csv')}><Download /> Full CSV</button>
        <button className="button" onClick={() => downloadBlob(toCsv(filtered), 'filtered_dataset.csv', 'text/csv')}><Download /> Filtered CSV</button>
        <button className="button" onClick={() => exportXlsx(records, 'full_dataset.xlsx')}><Download /> Excel</button>
        <button className="button" onClick={exportPdf}><Download /> PDF Summary</button>
      </section>
    </>}

    <footer>Static GitHub Pages application. All XML processing happens locally in your browser.</footer>
  </main>;
}
