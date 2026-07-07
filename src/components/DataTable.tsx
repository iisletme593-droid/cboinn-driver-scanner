import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

export interface Column<T> {
  key: string;
  header: string;
  /** flex-grow weight (relative width) */
  width: number;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHeight?: number;
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  onToggleAll?: (checked: boolean) => void;
  emptyText?: string;
}

/** Track a container's pixel size so react-window gets an explicit height. */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    rows,
    rowKey,
    rowHeight = 38,
    selectable,
    selected,
    onToggle,
    onToggleAll,
    emptyText,
  } = props;
  const [containerRef, size] = useElementSize();
  const allChecked =
    !!selectable && rows.length > 0 && !!selected && rows.every((r) => selected.has(rowKey(r)));

  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    // react-window taşma (overscan) sırasında veya liste küçülürken kısa süreli
    // sınır-dışı index isteyebilir; korumasız rowKey(row) çökmesini önle.
    if (!row) return null;
    const key = rowKey(row);
    const isSel = selected?.has(key);
    return (
      <div
        style={style}
        className={
          'flex items-center px-3 border-b border-white/5 ' +
          (isSel ? 'bg-blue-500/10 ' : index % 2 ? 'bg-white/[0.012] ' : '') +
          (isSel ? '' : 'hover:bg-white/[0.05]')
        }
      >
        {selectable && (
          <div className="w-8 shrink-0 flex items-center justify-center">
            <input
              type="checkbox"
              checked={!!isSel}
              onChange={() => onToggle?.(key)}
              className="accent-blue-500 cursor-pointer h-3.5 w-3.5"
            />
          </div>
        )}
        {columns.map((c) => (
          <div
            key={c.key}
            style={{ flex: `${c.width} 1 0`, textAlign: c.align ?? 'left' }}
            className="px-2 truncate text-[13px] text-white/85"
            title={c.render ? undefined : String((row as Record<string, unknown>)[c.key] ?? '')}
          >
            {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full rounded-xl border border-white/10 overflow-hidden bg-[#0f1626]">
      <div className="flex items-center px-3 h-10 shrink-0 bg-white/[0.05] border-b border-white/10 text-[11px] font-semibold text-white/55 uppercase tracking-wide">
        {selectable && (
          <div className="w-8 shrink-0 flex items-center justify-center">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => onToggleAll?.(e.target.checked)}
              className="accent-blue-500 cursor-pointer h-3.5 w-3.5"
            />
          </div>
        )}
        {columns.map((c) => (
          <div
            key={c.key}
            style={{ flex: `${c.width} 1 0`, textAlign: c.align ?? 'left' }}
            className="px-2 truncate"
          >
            {t(c.header)}
          </div>
        ))}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/35 text-sm">
            {emptyText ?? t('Kayıt yok.')}
          </div>
        ) : size.height > 0 ? (
          <FixedSizeList
            height={size.height}
            width={size.width}
            itemCount={rows.length}
            itemSize={rowHeight}
            overscanCount={10}
          >
            {Row}
          </FixedSizeList>
        ) : null}
      </div>
    </div>
  );
}
