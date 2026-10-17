import { Link, useSearchParams } from 'react-router-dom';
import { Page, Rise } from '../components/Page.jsx';
import { Card } from '../components/ui.jsx';

export default function Unsubscribed() {
  const [p] = useSearchParams();
  const ok = p.get('ok') === '1';
  return (
    <Page>
      <Rise><Card className="narrow-card">
        <div className="eyebrow">Email preferences</div>
        <h1>{ok ? 'You have been unsubscribed' : 'Link not recognised'}</h1>
        <p className="muted">{ok ? 'You will no longer receive draw reminders. This took effect immediately and has been logged. Entry confirmations and winner notifications are still sent because they are receipts for actions you take.' : 'This unsubscribe link is invalid or has expired. You can manage reminders from your dashboard.'}</p>
        <Link className="btn btn-ghost" to="/dashboard?tab=preferences">Manage preferences</Link>
      </Card></Rise>
    </Page>
  );
}
