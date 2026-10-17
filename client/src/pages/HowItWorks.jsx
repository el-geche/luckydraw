import { Link } from 'react-router-dom';
import { Page, Rise } from '../components/Page.jsx';
import { Card } from '../components/ui.jsx';

const CODE = `import seedrandom from 'seedrandom';

// 1. canonical order
entries.sort((a, b) => a.entryId - b.entryId);
// 2. weights
const weight = (e) => mode === 'equal' ? 1 : e.tickets; // tickets ∈ 1..10
// 3. contiguous ticket ranges, total W
let W = 0; for (const e of entries) { e.start = W; W += weight(e); e.end = W; }
// 4. one PRNG draw from the revealed seed
const u = seedrandom(seed)();          // ARC4, 0 <= u < 1
const ticket = Math.floor(u * W);
// 5. the winner's range contains the ticket
const winner = entries.find((e) => e.start <= ticket && ticket < e.end);`;

export default function HowItWorks() {
  return (
    <Page className="how">
      <Rise className="page-head"><div><div className="eyebrow">Transparency</div><h1>How a LuckyDraw is decided</h1><p className="lead small-lead">Algorithm <span className="mono">luckydraw-v1</span>. The same module runs on the server and in your browser.</p></div></Rise>
      <div className="two-col">
        <Rise><Card>
          <h3 className="card-title">Commit → reveal</h3>
          <ol className="steps">
            <li><strong>Commit.</strong> When a draw opens the server generates a random 256-bit seed and publishes <span className="mono">commitment = sha256(seed)</span>. The seed cannot be changed later without breaking the hash.</li>
            <li><strong>Enter.</strong> Members enter while the countdown runs — at most <strong>5 entries per person per draw</strong>, enforced in a database transaction on the server.</li>
            <li><strong>Close.</strong> At the closing time the entry list is frozen, ordered by entry ID, and hashed (<span className="mono">entriesHash</span>).</li>
            <li><strong>Reveal & draw.</strong> The seed is revealed and fed to the engine. The wheel animation is driven by the result: it rotates so the centre of the winning ticket lands under the pointer.</li>
            <li><strong>Publish.</strong> Seed, commitment, ordered entries, entries hash, <span className="mono">u</span>, ticket and winner are published for anyone to re-run on the <Link className="link" to="/verify">verification page</Link>.</li>
          </ol>
        </Card></Rise>
        <Rise><Card>
          <h3 className="card-title">Equal vs weighted</h3>
          <p><strong>Equal entry:</strong> one entry = one slice of weight 1. Your chance = your entries ÷ all entries.</p>
          <p><strong>Weighted:</strong> each entry carries 1–10 tickets (each ticket costs the ticket price); the entry’s slice is proportional to its tickets. Your chance = your tickets ÷ all tickets. The 5-entries-per-person cap still applies, so a person’s maximum weight is 50.</p>
          <h3 className="card-title" style={{ marginTop: 20 }}>Reference implementation</h3>
          <pre className="code">{CODE}</pre>
        </Card></Rise>
      </div>
      <Rise><Card className="note-card">
        <strong>Limitations of this demo:</strong> <span className="muted">the operator generates the seed, so commit–reveal proves the seed was fixed before the draw, but an operator who also adds entries could in principle grind outcomes. Production systems mix in public, post-close entropy (e.g. a future block hash or drand beacon). All money on this platform is simulated.</span>
      </Card></Rise>
    </Page>
  );
}
