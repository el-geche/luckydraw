import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { Card } from '../components/ui.jsx';

const FAQ = [
  { group: 'Odds', items: [
    ['How are my odds calculated?', 'Your chance is your share of the total weight in the draw. In an equal-entry draw that is your entries ÷ all entries. In a weighted draw it is your tickets ÷ all tickets. Every draw page shows a live odds table, and the results page shows the final odds for every participant.'],
    ['Do my odds change after I enter?', 'Yes — until the draw closes, other people can still enter, which grows the total and lowers everyone’s share proportionally. Once the draw closes the entry list is frozen and the odds are final.'],
    ['Is there a house edge or hidden weighting?', 'No. The winner is chosen solely from the published entry list and the revealed seed using the published algorithm. You can reproduce the result yourself on the verification page.'],
  ] },
  { group: 'The 5-entry cap', items: [
    ['Why can I only hold five entries in a draw?', 'The cap keeps draws accessible and stops any single participant from dominating the wheel. It applies per person, per draw.'],
    ['How is the cap enforced?', 'On the server, inside a database transaction that locks the draw while your entry is recorded. Simultaneous requests cannot push you past five, and the draw engine itself refuses to run on a list that breaks the cap.'],
    ['Does the cap apply to weighted draws?', 'Yes. You may hold up to five entries, each with 1–10 tickets, so your maximum weight in a weighted draw is 50 tickets.'],
  ] },
  { group: 'Equal vs weighted', items: [
    ['What is an equal-entry draw?', 'One entry equals one slice of the wheel, and every slice is the same size. Ticket counts are ignored.'],
    ['What is a weighted draw?', 'Each entry carries a number of tickets (1–10), priced per ticket. An entry’s slice is proportional to its tickets: a 4-ticket entry is four times as likely to win as a 1-ticket entry.'],
    ['Which mode is a draw using?', 'The mode is fixed when a draw is created and shown on every draw card, draw page, receipt and audit export.'],
  ] },
  { group: 'Seeds, commit–reveal and verification', items: [
    ['What is the server seed?', 'A 256-bit value from the operating system’s cryptographic random generator, created when a draw is set up. It is stored server-side only. No page, API response, log, email, export or admin screen shows it until the draw has closed, been sealed and been run.'],
    ['What does “commit–reveal” mean here?', 'When the draw opens we publish sha256(serverSeed) — the commitment — and anchor it with OpenTimestamps, so its publication time is independently provable. After the draw the seed is revealed and anyone can hash it and compare.'],
    ['What is the audit chain and the sealed hash?', 'Every entry confirmation is an append-only record that includes the hash of the previous record for that draw. Changing, removing or reordering any record changes every later hash. At close the final hash and record count are “sealed”, published and anchored; the database then refuses any further appends to that draw.'],
    ['How is the final random seed made?', 'crowdEntropy = SHA-256 of all receipt codes (upper-cased, sorted, joined by newlines). publicRandom = SHA-256(crowdEntropy ‖ drand beacon value). finalSeed = HMAC-SHA256(serverSeed, publicRandom ‖ sealHash). The drand round is chosen at seal time and lies in the future, so its value did not exist when entries closed.'],
    ['Why combine crowd entropy with an external beacon?', 'Receipt codes alone could be ground: the last entrant (or the operator) could keep retrying entries until the hash looked favourable. The drand round is fixed only after close and is outside anyone’s control, and the HMAC is keyed by a seed committed before the first entry. No single party can predict or steer the result.'],
    ['How is the winner picked?', 'Entries are ordered by entry ID and laid out as consecutive ticket ranges. u = seedrandom(finalSeed)() gives a number in [0, 1). The winning ticket is floor(u × total weight), and the winner is the entry whose range contains it.'],
    ['How do I verify a draw?', 'Open the draw’s Verify page and press “Verify this draw”. Your browser recomputes the audit chain and sealed hash, checks the anchor proofs commit to it, checks sha256(serverSeed) against the commitment, recomputes crowd entropy, public random and final seed, and re-runs the wheel — each step shown as Match or Mismatch. OpenTimestamps proofs show “pending” until Bitcoin confirms them (usually a few hours).'],
    ['What is my proof of entry?', 'Every confirmed entry produces a random, unguessable receipt code (e.g. LD-7K2Q-9MXA-…), emailed to you and recorded in the audit chain. Anyone can check it on the public “Verify a receipt” page, which shows only a masked display name.'],
    ['Can I download the audit record?', 'Yes. Results pages offer JSON and CSV exports (seed derivation, receipt codes, privacy-masked audit chain, anchor proofs, entry list and winner), each with its own SHA-256, plus a one-page Fairness Report PDF.'],
  ] },
  { group: 'Demo money', items: [
    ['Is any real money involved?', 'No. Deposits, entry fees, payouts and referral bonuses are simulated demo credits with no cash value. The optional Stripe integration runs in test mode only.'],
  ] },
];

function Item({ q, a, open, onToggle }) {
  return (
    <div className={`faq-item${open ? ' open' : ''}`}>
      <button className="faq-q" onClick={onToggle} aria-expanded={open}>
        <span>{q}</span>
        <motion.span className="faq-icon" animate={{ rotate: open ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}>+</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  const [open, setOpen] = useState('0-0');
  return (
    <Page className="faq">
      <Rise className="page-head"><div><div className="eyebrow">Help centre</div><h1>Frequently asked questions</h1><p className="lead small-lead">Odds, the entry cap, draw modes and how every result can be independently verified.</p></div>
        <div className="row-gap"><Link className="btn btn-ghost" to="/how-it-works">Algorithm details</Link><Link className="btn btn-gold" to="/verify">Verify a draw</Link></div></Rise>
      <div className="faq-groups">
        {FAQ.map((g, gi) => (
          <Rise key={g.group}><Card>
            <h3 className="card-title gold">{g.group}</h3>
            {g.items.map(([q, a], i) => <Item key={q} q={q} a={a} open={open === `${gi}-${i}`} onToggle={() => setOpen(open === `${gi}-${i}` ? null : `${gi}-${i}`)} />)}
          </Card></Rise>
        ))}
      </div>
    </Page>
  );
}
