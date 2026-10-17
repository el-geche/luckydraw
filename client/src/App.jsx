import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { DemoBanner, Header, Footer } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import DrawDetail from './pages/DrawDetail.jsx';
import Results from './pages/Results.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import Verify from './pages/Verify.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import NotFound from './pages/NotFound.jsx';
import History from './pages/History.jsx';
import Faq from './pages/Faq.jsx';
import Outbox from './pages/Outbox.jsx';
import VerifyReceipt, { LegacyReceiptRedirect } from './pages/VerifyReceipt.jsx';
import VerifyDraw from './pages/VerifyDraw.jsx';
import Upcoming from './pages/Upcoming.jsx';
import Winner from './pages/Winner.jsx';
import Unsubscribed from './pages/Unsubscribed.jsx';
import { PwaPrompts } from './components/Pwa.jsx';
import { Terms, Privacy } from './pages/Legal.jsx';

export default function App() {
  const location = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location.pathname]);
  return (
    <MotionConfig reducedMotion="user">
      <DemoBanner />
      <Header />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/draws/:id" element={<DrawDetail />} />
          <Route path="/draws/:id/results" element={<Results />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:id" element={<VerifyDraw />} />
          <Route path="/v/:id" element={<ShortVerify />} />
          <Route path="/verify-receipt" element={<VerifyReceipt />} />
          <Route path="/upcoming" element={<Upcoming />} />
          <Route path="/draws/:id/winner" element={<Winner />} />
          <Route path="/unsubscribed" element={<Unsubscribed />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/history" element={<History />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="/receipt" element={<LegacyReceiptRedirect />} />
          <Route path="/receipt/:code" element={<LegacyReceiptRedirect />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
      <Footer />
      <PwaPrompts />
    </MotionConfig>
  );
}

function ShortVerify() { const { id } = useParams(); return <Navigate to={`/verify/${id}`} replace />; }
