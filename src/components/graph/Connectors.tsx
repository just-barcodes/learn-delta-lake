import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TableState } from "../../domain/types";
import { computeEdges } from "../../viewmodel/graph";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Props {
  state: TableState;
  /** Bumped when the theme changes so strokes re-resolve their CSS-variable colors. */
  themeKey: string;
  mapRef: RefObject<Map<string, HTMLElement>>;
  innerRef: RefObject<HTMLDivElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
}

/**
 * Draws the bezier connector lines between node cards straight into the shared SVG
 * overlay. Renders nothing itself; it measures laid-out DOM, so it runs in a layout
 * effect and redraws on state, theme, resize, and font-load.
 */
export function Connectors({ state, themeKey, mapRef, innerRef, svgRef }: Props) {
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    const draw = () => {
      const svg = svgRef.current;
      const inner = innerRef.current;
      const map = mapRef.current;
      if (!svg || !inner || !map) return;

      const w = inner.scrollWidth;
      const h = inner.scrollHeight;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.style.width = w + "px";
      svg.style.height = h + "px";
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const base = inner.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      // getBoundingClientRect reports post-zoom (device) pixels, but the SVG is sized
      // in the pre-zoom layout space, so convert measured coordinates back by the zoom.
      const zoom = parseFloat(rootStyle.getPropertyValue("--page-zoom")) || 1;

      for (const e of computeEdges(state)) {
        const a = map.get(e.from);
        const b = map.get(e.to);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const x1 = (ra.right - base.left) / zoom;
        const y1 = (ra.top - base.top + ra.height / 2) / zoom;
        const x2 = (rb.left - base.left) / zoom;
        const y2 = (rb.top - base.top + rb.height / 2) / zoom;
        const dx = Math.max(30, (x2 - x1) * 0.5);
        const color = rootStyle.getPropertyValue(e.colorVar).trim() || "#888";

        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", e.dash ? "1.6" : "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("opacity", String(e.faint ? 0.1 : e.dash ? 0.65 : 0.9));
        if (e.dash) path.setAttribute("stroke-dasharray", "5 5");
        svg.appendChild(path);

        if (!e.dash && !e.faint) {
          const dot = document.createElementNS(SVG_NS, "circle");
          dot.setAttribute("cx", String(x2));
          dot.setAttribute("cy", String(y2));
          dot.setAttribute("r", "2.6");
          dot.setAttribute("fill", color);
          dot.setAttribute("opacity", "0.9");
          svg.appendChild(dot);
        }
      }
    };

    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    };

    schedule();

    const inner = innerRef.current;
    const ro = new ResizeObserver(schedule);
    if (inner) ro.observe(inner);
    window.addEventListener("resize", schedule);
    if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, themeKey]);

  return null;
}
