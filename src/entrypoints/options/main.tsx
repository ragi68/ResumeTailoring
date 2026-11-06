import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { MasterEditor } from '@/components/MasterEditor';
import { SettingsPanel } from '@/components/SettingsPanel';
import { LoadErrors } from '@/components/LoadErrors';
import { startStore, useApp } from '@/lib/store';
import '@/styles.css';

type Tab = 'master' | 'settings';

function OptionsApp() {
  const hydrated = useApp((s) => s.hydrated);
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#settings' ? 'settings' : 'master'));
  useEffect(() => {
    void startStore();
  }, []);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);
  return (
    <div className="page">
      <div className="row">
        <h1>Resume Tailor</h1>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'master'} className={tab === 'master' ? 'active' : ''} onClick={() => setTab('master')}>
          Master resume
        </button>
        <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>
      <LoadErrors />
      {!hydrated ? <p className="muted">Loading…</p> : tab === 'master' ? <MasterEditor /> : <SettingsPanel />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
