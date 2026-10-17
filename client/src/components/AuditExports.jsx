import { useApi } from '../lib/useApi.js';
import { Hash } from './ui.jsx';

/** Download links for the hashed JSON / CSV audit exports. */
export function AuditExports({ drawId }) {
  const { data } = useApi(`/draws/${drawId}/export-hashes`);
  return (
    <div className="exports">
      <div className="small muted">Audit export — entry list, seed, algorithm/version and winner</div>
      <div className="export-row">
        <a className="btn btn-ghost btn-sm" href={`/api/draws/${drawId}/export.json`} download>↓ JSON</a>
        <span className="small muted">sha256</span><Hash value={data?.json} n={10} label="JSON export hash" />
      </div>
      <div className="export-row">
        <a className="btn btn-ghost btn-sm" href={`/api/draws/${drawId}/export.csv`} download>↓ CSV</a>
        <span className="small muted">sha256</span><Hash value={data?.csv} n={10} label="CSV export hash" />
      </div>
      <div className="small muted">JSON: <span className="mono">exportSha256 = sha256(JSON.stringify(content))</span>. CSV: the last line holds sha256 of all preceding bytes.</div>
    </div>
  );
}
