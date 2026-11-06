/** CRUD editor for the master resume. All edits go through useApp.mutateMaster. */
import { useRef, useState } from 'react';
import type { Bullet, MasterResume } from '@/lib/schemas';
import { SEED_MASTER } from '@/lib/seed';
import { parseMasterImport } from '@/lib/storage';
import { useApp } from '@/lib/store';
import { detectMetric, newId } from '@/lib/text';
import { ItemControls, ListInput, Section, TextArea, TextField, moveItem } from './ui';

type Mutate = (fn: (m: MasterResume) => void) => void;

function BulletsEditor(props: { bullets: Bullet[]; mutate: (fn: (bullets: Bullet[]) => void) => void }) {
  const { bullets, mutate } = props;
  return (
    <div>
      {bullets.map((b, i) => (
        <div key={b.id} className="card soft">
          <div className="row nowrap">
            <span className="muted small grow">
              Bullet {i + 1} · <code>{b.id}</code>
            </span>
            <label className="row nowrap small">
              <input
                type="checkbox"
                checked={b.hasMetric}
                onChange={(e) => mutate((bs) => void (bs[i]!.hasMetric = e.target.checked))}
              />
              has metric
            </label>
            <ItemControls index={i} count={bullets.length} label="bullet" onMove={(f, t) => mutate((bs) => moveItem(bs, f, t))} onDelete={() => mutate((bs) => void bs.splice(i, 1))} />
          </div>
          <TextArea
            label="Text"
            rows={2}
            value={b.text}
            onChange={(v) =>
              mutate((bs) => {
                const prevAuto = detectMetric(bs[i]!.text) === bs[i]!.hasMetric;
                bs[i]!.text = v;
                if (prevAuto) bs[i]!.hasMetric = detectMetric(v);
              })
            }
          />
          <div className="grid2">
            <ListInput label="Tags" values={b.tags} placeholder="kubernetes, leadership" onChange={(v) => mutate((bs) => void (bs[i]!.tags = v))} />
            <TextArea
              label="Alternate phrasings (one per line, same facts)"
              rows={2}
              value={b.alternates.join('\n')}
              onChange={(v) => mutate((bs) => void (bs[i]!.alternates = v.split('\n').filter((l) => l.trim() !== '')))}
            />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => mutate((bs) => void bs.push({ id: newId('b'), text: 'New bullet', tags: [], hasMetric: false, alternates: [] }))}>
        + Add bullet
      </button>
    </div>
  );
}

function HeaderEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  const h = master.header;
  return (
    <Section title="Header" open>
      <div className="grid2">
        <TextField label="Name" value={h.name} onChange={(v) => mutate((m) => void (m.header.name = v))} />
        <TextField label="Email" type="email" value={h.email} onChange={(v) => mutate((m) => void (m.header.email = v))} />
        <TextField label="Phone" value={h.phone} onChange={(v) => mutate((m) => void (m.header.phone = v))} />
        <TextField label="Location" value={h.location} onChange={(v) => mutate((m) => void (m.header.location = v))} />
      </div>
      <h3>Links</h3>
      {h.links.map((l, i) => (
        <div className="row nowrap" key={i}>
          <div className="grow">
            <TextField label="Label (shown on the resume)" value={l.label} onChange={(v) => mutate((m) => void (m.header.links[i]!.label = v))} />
          </div>
          <div className="grow">
            <TextField label="URL" type="url" value={l.url} onChange={(v) => mutate((m) => void (m.header.links[i]!.url = v))} />
          </div>
          <ItemControls index={i} count={h.links.length} label="link" onMove={(f, t) => mutate((m) => moveItem(m.header.links, f, t))} onDelete={() => mutate((m) => void m.header.links.splice(i, 1))} />
        </div>
      ))}
      <button type="button" onClick={() => mutate((m) => void m.header.links.push({ label: '', url: '' }))}>
        + Add link
      </button>
    </Section>
  );
}

function SummariesEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  return (
    <Section title={`Summary variants (${master.summaries.length})`}>
      {master.summaries.map((s, i) => (
        <div className="card" key={s.id}>
          <div className="row nowrap">
            <div className="grow">
              <TextField label="Label" value={s.label} onChange={(v) => mutate((m) => void (m.summaries[i]!.label = v))} />
            </div>
            <ItemControls index={i} count={master.summaries.length} label="summary" onMove={(f, t) => mutate((m) => moveItem(m.summaries, f, t))} onDelete={() => mutate((m) => void m.summaries.splice(i, 1))} />
          </div>
          <TextArea label="Text" value={s.text} onChange={(v) => mutate((m) => void (m.summaries[i]!.text = v))} />
          <ListInput label="Tags" values={s.tags} onChange={(v) => mutate((m) => void (m.summaries[i]!.tags = v))} />
        </div>
      ))}
      <button type="button" onClick={() => mutate((m) => void m.summaries.push({ id: newId('sum'), label: 'New summary', text: '', tags: [] }))}>
        + Add summary variant
      </button>
    </Section>
  );
}

function ExperienceEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  return (
    <Section title={`Experience (${master.experience.length})`}>
      {master.experience.map((e, i) => (
        <details className="section" key={e.id}>
          <summary>
            {e.title || 'Untitled'} · {e.company || 'Company'} <span className="muted small">({e.bullets.length} bullets)</span>
          </summary>
          <div className="body">
            <div className="row nowrap">
              <span className="muted small grow">
                <code>{e.id}</code>
              </span>
              <ItemControls index={i} count={master.experience.length} label="role" onMove={(f, t) => mutate((m) => moveItem(m.experience, f, t))} onDelete={() => mutate((m) => void m.experience.splice(i, 1))} />
            </div>
            <div className="grid2">
              <TextField label="Title" value={e.title} onChange={(v) => mutate((m) => void (m.experience[i]!.title = v))} />
              <TextField label="Company" value={e.company} onChange={(v) => mutate((m) => void (m.experience[i]!.company = v))} />
              <TextField label="Location" value={e.location} onChange={(v) => mutate((m) => void (m.experience[i]!.location = v))} />
              <div className="row nowrap">
                <MonthField label="Start" value={e.start} onChange={(v) => mutate((m) => void (m.experience[i]!.start = v))} />
                <EndField value={e.end} onChange={(v) => mutate((m) => void (m.experience[i]!.end = v))} />
              </div>
            </div>
            <h3>Bullets</h3>
            <BulletsEditor bullets={e.bullets} mutate={(fn) => mutate((m) => fn(m.experience[i]!.bullets))} />
          </div>
        </details>
      ))}
      <button
        type="button"
        onClick={() =>
          mutate((m) =>
            void m.experience.unshift({ id: newId('exp'), company: 'New company', title: 'Title', location: '', start: '2024-01', end: 'present', bullets: [] }),
          )
        }
      >
        + Add role
      </button>
    </Section>
  );
}

function ProjectsEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  return (
    <Section title={`Projects pool (${master.projects.length})`}>
      <p className="muted small">Projects are a pool: tailoring picks the ones that fit each job.</p>
      {master.projects.map((p, i) => (
        <details className="section" key={p.id}>
          <summary>
            {p.name || 'Untitled project'} <span className="muted small">({p.bullets.length} bullets)</span>
          </summary>
          <div className="body">
            <div className="row nowrap">
              <div className="grow">
                <TextField label="Name" value={p.name} onChange={(v) => mutate((m) => void (m.projects[i]!.name = v))} />
              </div>
              <ItemControls index={i} count={master.projects.length} label="project" onMove={(f, t) => mutate((m) => moveItem(m.projects, f, t))} onDelete={() => mutate((m) => void m.projects.splice(i, 1))} />
            </div>
            <ListInput label="Tags" values={p.tags} onChange={(v) => mutate((m) => void (m.projects[i]!.tags = v))} />
            <h3>Links</h3>
            {p.links.map((l, li) => (
              <div className="row nowrap" key={li}>
                <div className="grow">
                  <TextField label="Label" value={l.label} onChange={(v) => mutate((m) => void (m.projects[i]!.links[li]!.label = v))} />
                </div>
                <div className="grow">
                  <TextField label="URL" type="url" value={l.url} onChange={(v) => mutate((m) => void (m.projects[i]!.links[li]!.url = v))} />
                </div>
                <ItemControls index={li} count={p.links.length} label="link" onMove={(f, t) => mutate((m) => moveItem(m.projects[i]!.links, f, t))} onDelete={() => mutate((m) => void m.projects[i]!.links.splice(li, 1))} />
              </div>
            ))}
            <button type="button" onClick={() => mutate((m) => void m.projects[i]!.links.push({ label: '', url: '' }))}>
              + Add link
            </button>
            <h3>Bullets</h3>
            <BulletsEditor bullets={p.bullets} mutate={(fn) => mutate((m) => fn(m.projects[i]!.bullets))} />
          </div>
        </details>
      ))}
      <button type="button" onClick={() => mutate((m) => void m.projects.push({ id: newId('proj'), name: 'New project', links: [], bullets: [], tags: [] }))}>
        + Add project
      </button>
    </Section>
  );
}

function SkillsEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  return (
    <Section title={`Skills (${master.skillGroups.reduce((n, g) => n + g.skills.length, 0)})`}>
      {master.skillGroups.map((g, gi) => (
        <div className="card" key={g.id}>
          <div className="row nowrap">
            <div className="grow">
              <TextField label="Group name" value={g.name} onChange={(v) => mutate((m) => void (m.skillGroups[gi]!.name = v))} />
            </div>
            <ItemControls index={gi} count={master.skillGroups.length} label="skill group" onMove={(f, t) => mutate((m) => moveItem(m.skillGroups, f, t))} onDelete={() => mutate((m) => void m.skillGroups.splice(gi, 1))} />
          </div>
          {g.skills.map((s, si) => (
            <div className="row nowrap" key={s.id}>
              <div style={{ width: '35%' }}>
                <TextField label="Skill" value={s.name} onChange={(v) => mutate((m) => void (m.skillGroups[gi]!.skills[si]!.name = v))} />
              </div>
              <div className="grow">
                <ListInput label="Aliases (used for keyword matching)" values={s.aliases} onChange={(v) => mutate((m) => void (m.skillGroups[gi]!.skills[si]!.aliases = v))} />
              </div>
              <ItemControls index={si} count={g.skills.length} label="skill" onMove={(f, t) => mutate((m) => moveItem(m.skillGroups[gi]!.skills, f, t))} onDelete={() => mutate((m) => void m.skillGroups[gi]!.skills.splice(si, 1))} />
            </div>
          ))}
          <button type="button" onClick={() => mutate((m) => void m.skillGroups[gi]!.skills.push({ id: newId('sk'), name: 'New skill', aliases: [] }))}>
            + Add skill
          </button>
        </div>
      ))}
      <button type="button" onClick={() => mutate((m) => void m.skillGroups.push({ id: newId('grp'), name: 'New group', skills: [] }))}>
        + Add skill group
      </button>
    </Section>
  );
}

function EducationEditor({ master, mutate }: { master: MasterResume; mutate: Mutate }) {
  return (
    <Section title={`Education (${master.education.length})`}>
      {master.education.map((e, i) => (
        <div className="card" key={e.id}>
          <div className="row nowrap">
            <span className="grow" />
            <ItemControls index={i} count={master.education.length} label="education entry" onMove={(f, t) => mutate((m) => moveItem(m.education, f, t))} onDelete={() => mutate((m) => void m.education.splice(i, 1))} />
          </div>
          <div className="grid2">
            <TextField label="School" value={e.school} onChange={(v) => mutate((m) => void (m.education[i]!.school = v))} />
            <TextField label="Degree" value={e.degree} onChange={(v) => mutate((m) => void (m.education[i]!.degree = v))} />
            <TextField label="Location" value={e.location} onChange={(v) => mutate((m) => void (m.education[i]!.location = v))} />
            <div className="row nowrap">
              <MonthField label="Start (optional)" value={e.start} allowEmpty onChange={(v) => mutate((m) => void (m.education[i]!.start = v))} />
              <EndField value={e.end} onChange={(v) => mutate((m) => void (m.education[i]!.end = v))} />
            </div>
          </div>
          <TextField label="Details (honors, GPA; optional)" value={e.details} onChange={(v) => mutate((m) => void (m.education[i]!.details = v))} />
        </div>
      ))}
      <button
        type="button"
        onClick={() => mutate((m) => void m.education.push({ id: newId('edu'), school: 'School', degree: 'Degree', location: '', start: '', end: '2020-06', details: '' }))}
      >
        + Add education
      </button>
    </Section>
  );
}

function MonthField(props: { label: string; value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <label className="field grow">
      <span>{props.label}</span>
      <input
        type="month"
        value={props.value === 'present' ? '' : props.value}
        onChange={(e) => {
          if (e.target.value || props.allowEmpty) props.onChange(e.target.value);
        }}
      />
    </label>
  );
}

function EndField(props: { value: string; onChange: (v: string) => void }) {
  const present = props.value === 'present';
  return (
    <div className="grow">
      <MonthField label="End" value={present ? '' : props.value} onChange={props.onChange} />
      <label className="small row nowrap">
        <input type="checkbox" checked={present} onChange={(e) => props.onChange(e.target.checked ? 'present' : new Date().toISOString().slice(0, 7))} />
        Present
      </label>
    </div>
  );
}

function ImportExport({ master }: { master: MasterResume }) {
  const replaceMaster = useApp((s) => s.replaceMaster);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function exportJson() {
    // Export is an explicit user action; this is the only place the master leaves the extension.
    const blob = new Blob([JSON.stringify(master, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'master-resume.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importJson(file: File) {
    const result = parseMasterImport(await file.text());
    if (!result.ok) {
      setMsg({ kind: 'error', text: `Import failed: ${result.error}` });
      return;
    }
    if (!confirm('Replace your master resume with the imported file?')) return;
    replaceMaster(result.master);
    setMsg({ kind: 'ok', text: 'Imported.' });
  }

  return (
    <Section title="Import / export">
      <div className="row">
        <button type="button" onClick={exportJson}>
          Export master JSON
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import master JSON…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (confirm('Replace your master resume with the sample resume?')) replaceMaster(structuredClone(SEED_MASTER));
          }}
        >
          Reset to sample
        </button>
      </div>
      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
    </Section>
  );
}

export function MasterEditor() {
  const master = useApp((s) => s.master);
  const mutateMaster = useApp((s) => s.mutateMaster);
  return (
    <div>
      <p className="muted">
        This is the source of truth. Tailoring only selects and orders this content. It never adds to it. Changes save automatically.
      </p>
      <HeaderEditor master={master} mutate={mutateMaster} />
      <SummariesEditor master={master} mutate={mutateMaster} />
      <ExperienceEditor master={master} mutate={mutateMaster} />
      <ProjectsEditor master={master} mutate={mutateMaster} />
      <SkillsEditor master={master} mutate={mutateMaster} />
      <EducationEditor master={master} mutate={mutateMaster} />
      <ImportExport master={master} />
    </div>
  );
}
