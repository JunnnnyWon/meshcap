import { useEffect, useState } from 'react';

export const ROUTES = ['tool', 'benchmark', 'method', 'about'] as const;
export type Route = (typeof ROUTES)[number];

const DEFAULT_ROUTE: Route = 'tool';

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : DEFAULT_ROUTE;
}

/**
 * GitHub Pages는 SPA 폴백을 제공하지 않으므로 해시 라우팅을 쓴다.
 * 새로고침이나 직접 링크 진입에서 404가 나지 않는다.
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (next: Route) => {
    window.location.hash = `#/${next}`;
  };

  return [route, navigate];
}
