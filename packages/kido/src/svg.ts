import { bounds } from "./utils";

export const Svg = {
  split: (str: string): Array<string | number> => {
    const out: Array<string | number> = [];
    const parts = String(str || "")
      .trim()
      .split(/\s+/);
    for (const part of parts) {
      const segs = part.split(",");
      for (const s of segs) out.push(isNaN(Number(s)) ? s : +s);
    }
    return out;
  },

  shapeLength: (el: SVGElement | HTMLElement | null): number => {
    const tag = el?.tagName?.toLowerCase();
    if (!tag) return 0;

    if (tag === "circle") {
      const r = parseFloat(el?.getAttribute("r") ?? "0") || 0;
      return 2 * Math.PI * r;
    }

    if (tag === "line") {
      const x1 = parseFloat(el?.getAttribute("x1") ?? "0") || 0;
      const x2 = parseFloat(el?.getAttribute("x2") ?? "0") || 0;
      const y1 = parseFloat(el?.getAttribute("y1") ?? "0") || 0;
      const y2 = parseFloat(el?.getAttribute("y2") ?? "0") || 0;
      const dx = x2 - x1;
      const dy = y2 - y1;
      return Math.sqrt(dx * dx + dy * dy);
    }

    try {
      const svgEl = el as SVGGeometryElement;
      if (typeof svgEl.getTotalLength === "function") {
        return svgEl.getTotalLength();
      }
    } catch {
      // ignore
    }

    const r = bounds(el);
    return 2 * (r.width + r.height);
  },
};
