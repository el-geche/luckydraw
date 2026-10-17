import { Link } from 'react-router-dom';
import { Page } from '../components/Page.jsx';
import { Card } from '../components/ui.jsx';
export default function NotFound() {
  return <Page><Card><h1>Page not found</h1><p className="muted">That page doesn’t exist.</p><Link to="/" className="btn btn-gold">Back to draws</Link></Card></Page>;
}
