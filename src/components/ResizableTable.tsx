import { useState } from "react";
import type { TableColumnsType } from "antd";

/** Header cell with a hand-written resize handle on its right edge (same approach
 * as the app's other splitters — no drag-and-drop library). mousedown starts a
 * global mousemove that reports the new column width. */
export const ResizableTitle = (props: any) => {
  const { onResize, width, children, ...restProps } = props;

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width as number;
    const move = (ev: MouseEvent) => {
      const next = Math.max(50, startW + (ev.clientX - startX));
      onResize?.(next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <th {...restProps}>
      {children}
      <span className="col-resize-handle" onMouseDown={startDrag} />
    </th>
  );
};

export function useResizableColumns<T extends object>(columns: TableColumnsType<T>): TableColumnsType<T> {
  const [widths, setWidths] = useState<Record<number, number>>({});
  return columns.map((col, index) => {
    const baseWidth = (col as any).width as number | undefined;
    const width = widths[index] ?? baseWidth;
    return {
      ...col,
      width,
      onHeaderCell: () => ({
        width,
        onResize: (w: number) => setWidths((prev) => ({ ...prev, [index]: Math.round(w) })),
      }),
    };
  });
}
