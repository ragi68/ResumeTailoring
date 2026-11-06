/** Vertical list reorderable by drag-and-drop (dnd-kit, mouse/touch/keyboard) and by ↑/↓ buttons. */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, ReactNode } from 'react';

export interface RowControls {
  /** Spread onto the drag handle button. */
  handle: ReactNode;
  moveUp: (() => void) | null;
  moveDown: (() => void) | null;
}

function SortableRow(props: { id: string; className?: string; children: (c: Pick<RowControls, 'handle'>) => ReactNode; as: 'li' | 'div' }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 10 : undefined };
  const handle = (
    <button type="button" className="handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to reorder" title="Drag to reorder">
      ⠿
    </button>
  );
  const Tag = props.as;
  return (
    <Tag ref={setNodeRef} style={style} className={`${props.className ?? ''}${isDragging ? ' dragging' : ''}`}>
      {props.children({ handle })}
    </Tag>
  );
}

export function SortableList<T>(props: {
  items: T[];
  getId: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number, controls: RowControls) => ReactNode;
  itemClassName?: (item: T) => string;
  as?: 'ul' | 'div';
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = props.items.map(props.getId);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) props.onMove(from, to);
  };
  const Outer = props.as ?? 'div';
  const rowTag = Outer === 'ul' ? 'li' : 'div';
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <Outer className={props.className}>
          {props.items.map((item, i) => (
            <SortableRow key={ids[i]} id={ids[i]!} as={rowTag} className={props.itemClassName?.(item)}>
              {({ handle }) =>
                props.renderItem(item, i, {
                  handle,
                  moveUp: i > 0 ? () => props.onMove(i, i - 1) : null,
                  moveDown: i < props.items.length - 1 ? () => props.onMove(i, i + 1) : null,
                })
              }
            </SortableRow>
          ))}
        </Outer>
      </SortableContext>
    </DndContext>
  );
}

export function MoveButtons({ controls, label }: { controls: RowControls; label: string }) {
  return (
    <>
      <button type="button" className="icon" aria-label={`Move ${label} up`} disabled={!controls.moveUp} onClick={() => controls.moveUp?.()}>
        ↑
      </button>
      <button type="button" className="icon" aria-label={`Move ${label} down`} disabled={!controls.moveDown} onClick={() => controls.moveDown?.()}>
        ↓
      </button>
    </>
  );
}
