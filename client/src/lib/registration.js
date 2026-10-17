import { useApi } from './useApi.js';

/** Whether public self-service sign-up is open on this backend (REGISTRATION_MODE, exposed via /api/meta). */
export function useRegistrationOpen() {
  const { data, loading } = useApi('/meta');
  // Until /api/meta answers, assume open (static demo + local dev); a closed server still rejects with 403.
  return { open: loading || data?.registrationMode !== 'closed', loading };
}
