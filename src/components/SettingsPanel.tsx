import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type LineBudget } from '@/lib/schemas';
import { getApiKey, setApiKey } from '@/lib/storage';
import { useApp } from '@/lib/store';
import { AttachDiagnostics } from './AttachDiagnostics';
import { Section, TextField } from './ui';

const BUDGET_LABELS: Record<keyof LineBudget, string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
};

function ApiKeyField() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<'idle' | 'saved'>('idle');
  const [hasKey, setHasKey] = useState(false);
  useEffect(() => {
    void getApiKey().then((k) => setHasKey(k !== ''));
  }, []);
  return (
    <div>
      <div className="row nowrap">
        <div className="grow">
          <TextField
            label={hasKey ? 'Anthropic API key (saved; enter a new one to replace it)' : 'Anthropic API key'}
            type="password"
            value={value}
            placeholder="sk-ant-…"
            testId="api-key"
            onChange={(v) => {
              setValue(v);
              setSaved('idle');
            }}
          />
        </div>
        <button
          type="button"
          className="primary"
          disabled={!value.trim()}
          onClick={() =>
            void setApiKey(value).then(() => {
              setValue('');
              setHasKey(true);
              setSaved('saved');
            })
          }
        >
          Save key
        </button>
        {hasKey && (
          <button
            type="button"
            className="danger"
            onClick={() =>
              void setApiKey('').then(() => {
                setHasKey(false);
                setSaved('idle');
              })
            }
          >
            Remove
          </button>
        )}
      </div>
      {saved === 'saved' && <div className="banner ok">Key saved to this browser's extension storage.</div>}
      <p className="muted small">
        Stored only in chrome.storage.local on this device. Calls go from the extension's background worker straight to api.anthropic.com.
      </p>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  return (
    <div>
      <Section title="Anthropic API" open>
        <ApiKeyField />
        <div className="grid2">
          <TextField label="Tailoring model (selection, rewrites)" value={settings.tailorModel} placeholder={DEFAULT_SETTINGS.tailorModel} onChange={(v) => update({ tailorModel: v })} />
          <TextField label="JD analysis model" value={settings.analyzeModel} placeholder={DEFAULT_SETTINGS.analyzeModel} onChange={(v) => update({ analyzeModel: v })} />
        </div>
        <p className="muted small">
          Leave a field empty to use the default: {DEFAULT_SETTINGS.tailorModel} for tailoring, {DEFAULT_SETTINGS.analyzeModel} for analysis.
        </p>
      </Section>

      <Section title="Page length" open>
        <div className="row">
          <label className="row nowrap">
            <input type="radio" name="pages" checked={settings.pageLimit === 1} onChange={() => update({ pageLimit: 1 })} /> 1 page
          </label>
          <label className="row nowrap">
            <input type="radio" name="pages" checked={settings.pageLimit === 2} onChange={() => update({ pageLimit: 2 })} /> 2 pages
          </label>
          <label className="row nowrap">
            <input type="checkbox" checked={settings.autoFit} onChange={(e) => update({ autoFit: e.target.checked })} /> Trim automatically after tailoring
          </label>
        </div>
        <h3>Line budget per section (for one page; doubled for two)</h3>
        <div className="grid2">
          {(Object.keys(BUDGET_LABELS) as (keyof LineBudget)[]).map((k) => (
            <label className="field" key={k}>
              <span>{BUDGET_LABELS[k]}</span>
              <input
                type="number"
                min={0}
                max={80}
                value={settings.lineBudget[k]}
                onChange={(e) => update({ lineBudget: { ...settings.lineBudget, [k]: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </label>
          ))}
        </div>
        <button type="button" onClick={() => update({ lineBudget: DEFAULT_SETTINGS.lineBudget })}>
          Reset budgets
        </button>
      </Section>

      <Section title="File name">
        <TextField label="Pattern ({name}, {company}, {title})" value={settings.fileNamePattern} placeholder={DEFAULT_SETTINGS.fileNamePattern} onChange={(v) => update({ fileNamePattern: v })} />
      </Section>

      <Section title="Diagnostics">
        <p className="muted small">Attach a hardcoded test PDF to the job page you last focused, to check that attaching works on a site.</p>
        <AttachDiagnostics />
      </Section>
    </div>
  );
}
