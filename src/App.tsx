import { useEffect, useState } from 'react';
import {
  DEFAULT_SITE_DATA,
  type MediaAsset,
  type ProjectItem,
  type ServiceItem,
  type SiteConfig,
} from './shared/siteData';
import { PublicSite } from './components/PublicSite';
import { AdminDashboard } from './components/AdminDashboard';

interface SitePayload {
  config: SiteConfig;
  services: ServiceItem[];
  projects: ProjectItem[];
  media: MediaAsset[];
}

export default function App() {
  const [view, setView] = useState<'public' | 'admin'>(() =>
    window.location.hash === '#admin' ? 'admin' : 'public'
  );

  const [site, setSite] = useState<SitePayload>({
    config: DEFAULT_SITE_DATA.config,
    services: DEFAULT_SITE_DATA.services,
    projects: DEFAULT_SITE_DATA.projects,
    media: DEFAULT_SITE_DATA.media,
  });

  useEffect(() => {
    let active = true;
    fetch('/api/site')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && data.config) {
          setSite({
            config: data.config,
            services: data.services ?? DEFAULT_SITE_DATA.services,
            projects: data.projects ?? DEFAULT_SITE_DATA.projects,
            media: data.media ?? DEFAULT_SITE_DATA.media,
          });
        }
      })
      .catch(() => {
        // Fallback to seed data if initial fetch fails
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onHash = () => {
      setView(window.location.hash === '#admin' ? 'admin' : 'public');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openAdmin = () => {
    window.location.hash = 'admin';
    setView('admin');
    window.scrollTo({ top: 0 });
  };

  const openPublic = () => {
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setView('public');
    window.scrollTo({ top: 0 });
  };

  if (view === 'admin') {
    return (
      <AdminDashboard
        config={site.config}
        services={site.services}
        projects={site.projects}
        media={site.media}
        onDataUpdated={(next) => setSite(next)}
        onBackToSite={openPublic}
      />
    );
  }

  return (
    <PublicSite
      config={site.config}
      services={site.services}
      projects={site.projects}
      onOpenAdmin={openAdmin}
    />
  );
}
