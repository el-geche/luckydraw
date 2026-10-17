import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Page, Rise } from '../components/Page.jsx';
import { Card } from '../components/ui.jsx';

const UPDATED = '17 October 2026';

function LegalDoc({ eyebrow, title, intro, sections }) {
  return (
    <Page className="legal">
      <Rise className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="muted small">Last updated {UPDATED}</p></div></Rise>
      <div className="legal-grid">
        <Rise as="nav" className="legal-toc card">
          <div className="small muted" style={{ marginBottom: 8 }}>Contents</div>
          {sections.map((s, i) => <a key={s.h} href={`#s${i + 1}`}>{i + 1}. {s.h}</a>)}
        </Rise>
        <Rise><Card className="legal-body">
          <div className="note note-gold"><strong>Demonstration platform.</strong> LuckyDraw is demonstration software. It does not accept, hold or pay out real money, and no prize described on this site has monetary value. Every balance, deposit, entry fee, payout and bonus is simulated.</div>
          <p className="lead small-lead">{intro}</p>
          {sections.map((s, i) => (
            <motion.section key={s.h} id={`s${i + 1}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04 }}>
              <h2>{i + 1}. {s.h}</h2>
              {s.p.map((t, j) => <p key={j}>{t}</p>)}
            </motion.section>
          ))}
        </Card></Rise>
      </div>
    </Page>
  );
}

export function Terms() {
  return <LegalDoc eyebrow="Legal" title="Terms of Service" intro="These Terms govern your use of the LuckyDraw demonstration platform. By creating an account or entering a draw you agree to them."
    sections={[
      { h: 'Nature of the service', p: ['LuckyDraw demonstrates how a transparent, verifiable raffle platform can operate. It is provided for evaluation, education and testing only.', 'No real-money gambling, lottery or sweepstakes is offered. Demo credits cannot be purchased with, exchanged for, or withdrawn as real currency, goods or services.'] },
      { h: 'Eligibility and accounts', p: ['You must provide accurate information when registering. Demo accounts may be reset or deleted at any time without notice, including all entries, receipts and simulated balances.', 'You are responsible for keeping your credentials confidential. Seeded demo accounts use publicly documented passwords and must not be used to store personal information.'] },
      { h: 'Draws and entries', p: ['Each draw states its mode (equal or weighted), its simulated entry price, its closing time and its simulated prize. A person may hold at most five (5) entries in any single draw; the platform rejects entries above this limit.', 'In equal mode each entry has one equal chance. In weighted mode an entry’s chance is proportional to the number of tickets (1–10) it carries. Odds are displayed on every draw page before you enter.', 'Entries are final once confirmed. A proof-of-entry receipt is issued for every confirmed entry.'] },
      { h: 'Draw procedure and fairness', p: ['When a draw opens, a secret seed is generated and its SHA-256 commitment is published. At the draw the seed is revealed and the winner is selected by the published algorithm (luckydraw-v1), which anyone can reproduce on the verification page.', 'If a draw receives no entries it is declared void and its seed is published.', 'The published audit record is the authoritative result. The wheel animation is a visual representation of that result.'] },
      { h: 'Simulated payments and prizes', p: ['Deposits are simulated and require no payment details. An optional Stripe integration operates in test mode only and never charges a real card.', 'Prize payouts and referral bonuses are credited as demo credits to the winner’s simulated wallet. They have no cash value.'] },
      { h: 'Acceptable use', p: ['You must not attempt to circumvent the entry cap, interfere with the platform, probe it for vulnerabilities outside an agreed scope, or impersonate another member.', 'We may suspend accounts or void entries that breach these Terms.'] },
      { h: 'Disclaimers and liability', p: ['The platform is provided “as is” without warranties of any kind. To the extent permitted by law we are not liable for any loss arising from use of a demonstration system, including loss of demo data.'] },
      { h: 'Changes', p: ['We may update these Terms. Material changes will be indicated by the “last updated” date above. Continued use after a change constitutes acceptance.'] },
    ]} />;
}

export function Privacy() {
  return <LegalDoc eyebrow="Legal" title="Privacy Policy" intro="This policy explains what information the LuckyDraw demonstration platform processes and why. We collect the minimum needed to run verifiable draws."
    sections={[
      { h: 'Information we process', p: ['Account data: your name, email address, a salted password hash and your referral code.', 'Activity data: your entries (entry IDs, ticket counts, timestamps), proof-of-entry receipts, and the simulated wallet ledger.', 'We do not collect payment card details. Simulated deposits require none; the optional Stripe test mode uses Stripe’s test card tokens only.'] },
      { h: 'What is published', p: ['To make draws verifiable, each completed draw publishes its ordered entry list. Participants appear only as a masked display name (first name and last initial, e.g. “Ava M.”) and an internal numeric user ID. Email addresses are never published.', 'Receipt pages show the masked name of the holder, the draw and the entry IDs covered by the receipt.'] },
      { h: 'Email', p: ['After each entry the platform generates a proof-of-entry email. In the default configuration emails are not delivered: they are written to a local development outbox and shown in the in-app Demo outbox. Real delivery only occurs if an operator explicitly configures an SMTP server.'] },
      { h: 'How we use information', p: ['To authenticate you, enforce the five-entries-per-person cap, run and audit draws, credit simulated payouts and bonuses, and send entry receipts. We do not sell personal information or use it for advertising.'] },
      { h: 'Retention', p: ['Demo data may be reset at any time by the operator, which deletes all accounts other than the seeded demo accounts. Published audit records are retained for as long as the draw is listed.'] },
      { h: 'Security', p: ['Passwords are stored as bcrypt hashes. Sessions use signed tokens. Draw seeds remain secret until the draw runs; only their SHA-256 commitment is public beforehand.'] },
      { h: 'Your choices', p: ['You may ask the operator to delete your demo account. Because published audit records must remain reproducible, a deleted participant’s masked entry may remain in historical draw records.'] },
      { h: 'Contact', p: ['This is demonstration software. For questions about a deployment of LuckyDraw, contact the operator of that deployment.'] },
    ]} />;
}

export function LegalLinks() {
  return <><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></>;
}
