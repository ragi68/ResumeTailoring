/** Per-job editor: summary choice, ordered/included roles, projects, bullets, education, and skills. */
import { useMemo, useState } from 'react';
import type { BlockType, MasterResume, Selection, SelectionBlock } from '@/lib/schemas';
import { indexMaster, moveBlockWithinType, moveInArray } from '@/lib/selection';
import { useApp } from '@/lib/store';
import { newId } from '@/lib/text';
import { MoveButtons, SortableList } from './SortableList';

function PinButton({ id, label }: { id: string; label: string }) {
  const pinned = useApp((s) => s.pins.includes(id));
  const toggle = useApp((s) => s.togglePin);
  return (
    <button
      type="button"
      className={`icon ${pinned ? 'pin-on' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${label}` : `Pin ${label} (always include)`}
      title={pinned ? 'Pinned: always included' : 'Pin: always include'}
      onClick={() => toggle(id)}
    >
      {pinned ? '★' : '☆'}
    </button>
  );
}

function blockLabel(master: MasterResume, b: SelectionBlock): { title: string; sub: string } {
  if (b.type === 'experience') {
    const e = master.experience.find((x) => x.id === b.refId);
    return { title: e ? `${e.title}, ${e.company}` : b.refId, sub: e ? `${e.start} → ${e.end}` : '' };
  }
  if (b.type === 'project') {
    const p = master.projects.find((x) => x.id === b.refId);
    return { title: p?.name ?? b.refId, sub: p?.tags.join(', ') ?? '' };
  }
  const e = master.education.find((x) => x.id === b.refId);
  return { title: e ? `${e.degree}, ${e.school}` : b.refId, sub: '' };
}

function BulletList({ sel, blockIndex, master }: { sel: Selection; blockIndex: number; master: MasterResume }) {
  const mutate = useApp((s) => s.mutateSelection);
  const pins = useApp((s) => s.pins);
  const idx = useMemo(() => indexMaster(master), [master]);
  const block = sel.blocks[blockIndex]!;
  if (block.bullets.length === 0) return <p className="muted small" style={{ padding: '4px 8px' }}>No bullets in the master for this item.</p>;
  return (
    <SortableList
      as="ul"
      className="bullets"
      items={block.bullets}
      getId={(b) => b.id}
      itemClassName={(b) => `bullet${b.included ? '' : ' excluded'}`}
      onMove={(from, to) => mutate(sel.id, (d) => moveInArray(d.blocks[blockIndex]!.bullets, from, to))}
      renderItem={(ref, i, controls) => {
        const bullet = idx.bullets.get(ref.id);
        const override = sel.textOverrides[ref.id];
        const pinned = pins.includes(ref.id);
        return (
          <>
            {controls.handle}
            <input
              type="checkbox"
              checked={ref.included || pinned}
              disabled={pinned}
              aria-label="Include bullet"
              onChange={(e) => mutate(sel.id, (d) => void (d.blocks[blockIndex]!.bullets[i]!.included = e.target.checked))}
            />
            <span className="bullet-text">
              {override !== undefined ? (
                <>
                  <span className="override" title="Accepted rewrite">
                    {override}
                  </span>{' '}
                  <button
                    type="button"
                    className="link small"
                    onClick={() => mutate(sel.id, (d) => void delete d.textOverrides[ref.id])}
                  >
                    revert
                  </button>
                </>
              ) : (
                (bullet?.text ?? <em className="muted">missing bullet {ref.id}</em>)
              )}
              {bullet?.hasMetric && <span className="muted small"> · metric</span>}
            </span>
            <PinButton id={ref.id} label="bullet" />
            <MoveButtons controls={controls} label="bullet" />
          </>
        );
      }}
    />
  );
}

function BlockSection({ sel, master, type, title }: { sel: Selection; master: MasterResume; type: BlockType; title: string }) {
  const mutate = useApp((s) => s.mutateSelection);
  const pins = useApp((s) => s.pins);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const typed = sel.blocks.map((b, i) => ({ b, i })).filter((x) => x.b.type === type);
  if (typed.length === 0) return null;
  const includedCount = typed.filter((x) => x.b.included).length;
  return (
    <section>
      <h2>
        {title} <span className="muted small">({includedCount}/{typed.length} included)</span>
      </h2>
      <SortableList
        items={typed}
        getId={(x) => x.b.refId}
        itemClassName={(x) => `block${x.b.included ? '' : ' excluded'}`}
        onMove={(from, to) => mutate(sel.id, (d) => moveBlockWithinType(d, type, from, to))}
        renderItem={({ b, i }, _ti, controls) => {
          const label = blockLabel(master, b);
          const open = openIds.has(b.refId);
          const pinned = pins.includes(b.refId);
          const shown = b.bullets.filter((r) => r.included).length;
          return (
            <>
              <div className="block-head">
                {controls.handle}
                <input
                  type="checkbox"
                  checked={b.included || pinned}
                  disabled={pinned}
                  aria-label={`Include ${label.title}`}
                  onChange={(e) => mutate(sel.id, (d) => void (d.blocks[i]!.included = e.target.checked))}
                />
                {type !== 'education' ? (
                  <button
                    type="button"
                    className="icon"
                    aria-expanded={open}
                    aria-label={open ? 'Hide bullets' : 'Show bullets'}
                    onClick={() =>
                      setOpenIds((s) => {
                        const n = new Set(s);
                        if (n.has(b.refId)) n.delete(b.refId);
                        else n.add(b.refId);
                        return n;
                      })
                    }
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : null}
                <span className="block-title" title={label.title}>
                  {label.title}
                  {type !== 'education' && <span className="muted small"> · {shown}/{b.bullets.length}</span>}
                </span>
                <PinButton id={b.refId} label={label.title} />
                <MoveButtons controls={controls} label={label.title} />
              </div>
              {open && <BulletList sel={sel} blockIndex={i} master={master} />}
            </>
          );
        }}
      />
    </section>
  );
}

function SummaryPicker({ sel, master }: { sel: Selection; master: MasterResume }) {
  const mutate = useApp((s) => s.mutateSelection);
  return (
    <section>
      <h2>Summary</h2>
      <select
        value={sel.summaryId ?? ''}
        aria-label="Summary variant"
        onChange={(e) => mutate(sel.id, (d) => void (d.summaryId = e.target.value || null))}
      >
        <option value="">(no summary)</option>
        {master.summaries.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {sel.summaryId && <p className="muted small">{master.summaries.find((s) => s.id === sel.summaryId)?.text}</p>}
    </section>
  );
}

function SkillsEditor({ sel, master }: { sel: Selection; master: MasterResume }) {
  const mutate = useApp((s) => s.mutateSelection);
  const mutateMaster = useApp((s) => s.mutateMaster);
  const pins = useApp((s) => s.pins);
  const togglePin = useApp((s) => s.togglePin);
  const idx = useMemo(() => indexMaster(master), [master]);
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState(master.skillGroups[0]?.id ?? '');
  const hidden = master.skillGroups.map((g) => ({ g, skills: g.skills.filter((s) => !sel.skillIds.includes(s.id)) })).filter((x) => x.skills.length);

  return (
    <section>
      <h2>
        Skills <span className="muted small">({sel.skillIds.length} shown)</span>
      </h2>
      <div>
        {sel.skillIds.map((id, i) => {
          const s = idx.skills.get(id);
          const pinned = pins.includes(id);
          return (
            <span key={id} className={`chip ${pinned ? 'active' : ''}`}>
              <button type="button" aria-label={`Move ${s?.name} left`} disabled={i === 0} onClick={() => mutate(sel.id, (d) => moveInArray(d.skillIds, i, i - 1))}>
                ‹
              </button>
              {s?.name ?? id}
              <button type="button" aria-label={pinned ? `Unpin ${s?.name}` : `Pin ${s?.name}`} title="Pin: always include" onClick={() => togglePin(id)}>
                {pinned ? '★' : '☆'}
              </button>
              <button
                type="button"
                aria-label={`Remove ${s?.name}`}
                disabled={pinned}
                onClick={() => mutate(sel.id, (d) => void (d.skillIds = d.skillIds.filter((x) => x !== id)))}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {hidden.length > 0 && (
        <div className="row" style={{ marginTop: 6 }}>
          <select
            aria-label="Add a skill from your master resume"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              if (id) mutate(sel.id, (d) => void (d.skillIds = [...d.skillIds, id]));
            }}
          >
            <option value="">+ Add skill from master…</option>
            {hidden.map(({ g, skills }) => (
              <optgroup key={g.id} label={g.name}>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <form
        className="row nowrap"
        style={{ marginTop: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name || !newGroup) return;
          const id = newId('sk');
          mutateMaster((m) => void m.skillGroups.find((g) => g.id === newGroup)?.skills.push({ id, name, aliases: [] }));
          mutate(sel.id, (d) => void d.skillIds.push(id));
          setNewName('');
        }}
      >
        <input type="text" className="grow" placeholder="New skill you have (adds to master)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select aria-label="Skill group" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} style={{ width: 'auto' }}>
          {master.skillGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!newName.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

export function BlockEditor({ sel }: { sel: Selection }) {
  const master = useApp((s) => s.master);
  return (
    <div>
      <SummaryPicker sel={sel} master={master} />
      <BlockSection sel={sel} master={master} type="experience" title="Experience" />
      <BlockSection sel={sel} master={master} type="project" title="Projects" />
      <SkillsEditor sel={sel} master={master} />
      <BlockSection sel={sel} master={master} type="education" title="Education" />
    </div>
  );
}
