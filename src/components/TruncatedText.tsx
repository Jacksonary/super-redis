import { useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import type { CSSProperties } from "react";

/** Show an antd Tooltip ONLY when the content is actually truncated by ellipsis
 * (scrollWidth > clientWidth). Short content renders as plain text with no
 * tooltip — floating a full tooltip on every cell is noisy. The parent cell is
 * expected to constrain the width (column ellipsis / overflow:hidden). */
export function TruncatedText({
  children,
  placement,
  style,
  className,
}: {
  children: string;
  placement?: "top" | "bottom" | "left" | "right" | "bottomLeft" | "topLeft";
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <Tooltip title={truncated ? children : undefined} placement={placement}>
      <span
        ref={ref}
        style={{ display: "inline-block", maxWidth: "100%", verticalAlign: "bottom", ...style }}
        className={className}
      >
        {children}
      </span>
    </Tooltip>
  );
}
