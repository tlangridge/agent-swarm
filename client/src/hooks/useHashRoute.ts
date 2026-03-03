import { useState, useEffect, useCallback } from 'react';

export function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const match = hash.match(/^#\/office\/(.+)$/);
  const officeId = match ? match[1] : null;

  const setOfficeId = useCallback((id: string | null) => {
    window.location.hash = id ? `#/office/${id}` : '';
  }, []);

  return { officeId, setOfficeId };
}
