import { Anima } from "./anima";
import { Raf } from "./raf";
import { ResizeHub } from "./resize";
import { Split } from "./split";
import type { RevealConfig, RevealSelectors } from "./types";
import { bounds, queryAll } from "./utils";

interface ZoneConfig {
  contentNodes: Element[];
  contentNodeCount: number;
  lineNodes: Element[];
  lineNodeCount: number;
  totalNodeCount: number;
  delay: number;
  isInViewport: boolean;
}

const BASE_STROKE_WIDTH = 50;
const DEFAULT_DELAY = 200;
const DEFAULT_OPACITY_DURATION = 600;
const DEFAULT_SPLIT_DURATION = 1000;
const DEFAULT_OPACITY_EASE: number[] = [0.33, 1, 0.68, 1];
const OPACITY_STAGGER = 100;
const SPLIT_STAGGER = 100;
const OFFSCREEN_TRANSLATE = 102;
const TILT_ROTATION = -30;

// Default selectors for reveal zones
const DEFAULT_SELECTORS: Required<RevealSelectors> = {
  opacity: ".z__o",
  split: ".z__s",
  div: ".z__d",
  svg: ".z__g",
};

function resolveScopeRoot(root?: HTMLElement | null): ParentNode {
  if (root && "querySelectorAll" in root) return root;
  return document;
}

function parseIndex(token: string | undefined): number {
  const value = parseInt(token ?? "", 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Scroll-triggered reveal animation system.
 *
 * Finds elements with specific class names and animates them into view
 * when scrolled into the viewport.
 *
 * Zone classes (defaults, can be customized via selectors config):
 * - `.z__o` - Opacity fade in
 * - `.z__s` - Split text animation (word by word)
 * - `.z__d` - Div scale animation
 * - `.z__g` - SVG mask reveal
 *
 * @example
 * ```ts
 * const reveal = new Reveal();
 * reveal.init({
 *   root: document.getElementById('page'),
 *   delay: 200,
 *   getScrollPosition: () => myScroller.current,
 *   // Custom selectors (optional)
 *   selectors: {
 *     split: ".my-split-text",  // Use .my-split-text instead of .z__s
 *   },
 * });
 *
 * // Clean up when done
 * reveal.destroy();
 * ```
 */
export class Reveal {
  protected raf: Raf | null = null;
  private isVisible: boolean[] = [];
  private scrollThreshold: number[] = [];
  private animationTargets: Element[] = [];
  private timelines: Anima[][] = [];
  private totalZoneCount = 0;

  private opacityZones: Element[] = [];
  private opacityZonesLength = 0;
  private splitZones: Element[] = [];
  private splitZonesLength = 0;
  private splitInstances: Array<Split | null> = [];

  private divZones: Element[] = [];
  private divZonesLength = 0;

  private svgZones: Element[] = [];
  private svgZonesLength = 0;

  private baseDelay = DEFAULT_DELAY;
  private delayStep = 100;
  private opacityDuration = DEFAULT_OPACITY_DURATION;
  private opacityEase: string | number[] = DEFAULT_OPACITY_EASE;
  private splitDuration = DEFAULT_SPLIT_DURATION;
  private resizeId: symbol | null = null;

  // Configuration
  private _getScrollPosition: (() => number) | null = null;
  private _viewportHeight: number | (() => number) | null = null;
  private _selectors: Required<RevealSelectors> = { ...DEFAULT_SELECTORS };

  private readonly handleResize = () => {
    this.splitLineMarkup();
    this.prepare();
    this.loop();
  };

  /**
   * Initialize the reveal system
   */
  init(config: RevealConfig = {}): void {
    this.stopLoop();
    if (this.resizeId) {
      ResizeHub.remove(this.resizeId);
      this.resizeId = null;
    }

    // Store configuration
    this._getScrollPosition = config.getScrollPosition ?? null;
    this._viewportHeight = config.viewportHeight ?? null;
    this._selectors = {
      ...DEFAULT_SELECTORS,
      ...config.selectors,
    };

    const scopeRoot = resolveScopeRoot(config.root ?? null);
    const delayFromConfig =
      typeof config.delay === "number"
        ? config.delay
        : typeof config.de === "number"
          ? config.de
          : DEFAULT_DELAY;

    this.delayStep = config.useReducedDelay ? 70 : 100;
    this.baseDelay = delayFromConfig;
    this.opacityDuration = DEFAULT_OPACITY_DURATION;
    this.opacityEase = DEFAULT_OPACITY_EASE;
    this.splitDuration = DEFAULT_SPLIT_DURATION;

    this.animationTargets = [];
    this.timelines = [];
    this.isVisible = [];
    this.scrollThreshold = [];
    this.splitInstances = [];

    this.opacityZones = queryAll(scopeRoot, this._selectors.opacity);
    this.opacityZonesLength = this.opacityZones.length;

    this.splitZones = queryAll(scopeRoot, this._selectors.split);
    this.splitZonesLength = this.splitZones.length;

    this.divZones = queryAll(scopeRoot, this._selectors.div);
    this.divZonesLength = this.divZones.length;

    this.svgZones = queryAll(scopeRoot, this._selectors.svg);
    this.svgZonesLength = this.svgZones.length;

    this.totalZoneCount =
      this.opacityZonesLength +
      this.splitZonesLength +
      this.divZonesLength +
      this.svgZonesLength;

    this.splitInstances = this.splitZones.map((zone) =>
      zone instanceof HTMLElement ? new Split(zone) : null
    );

    this.splitLineMarkup();
    this.prepare();
    this.loop();
    this.startLoop();
    this.resizeId = ResizeHub.add(this.handleResize);
  }

  /**
   * Clean up the reveal system
   */
  destroy(): void {
    this.stopLoop();
    if (this.resizeId) {
      ResizeHub.remove(this.resizeId);
      this.resizeId = null;
    }
    this.opacityZones = [];
    this.opacityZonesLength = 0;
    this.splitZones = [];
    this.splitZonesLength = 0;
    this.splitInstances = [];
    this.divZones = [];
    this.divZonesLength = 0;
    this.svgZones = [];
    this.svgZonesLength = 0;
    this.animationTargets = [];
    this.timelines = [];
    this.isVisible = [];
    this.scrollThreshold = [];
    this.totalZoneCount = 0;
  }

  private getViewportHeight(): number {
    if (typeof this._viewportHeight === "function") {
      return this._viewportHeight();
    }
    if (typeof this._viewportHeight === "number") {
      return this._viewportHeight;
    }
    return window.innerHeight;
  }

  private getCurrentScroll(): number {
    if (this._getScrollPosition) {
      return this._getScrollPosition();
    }
    return window.scrollY ?? window.pageYOffset ?? document.documentElement.scrollTop ?? 0;
  }

  private splitLineMarkup(): void {
    if (this.splitZonesLength === 0) return;

    const baseIndex = this.opacityZonesLength;

    for (
      let splitIndex = 0;
      splitIndex < this.splitZonesLength;
      splitIndex += 1
    ) {
      const zone = this.splitZones[splitIndex];
      if (!(zone instanceof HTMLElement)) continue;

      let instance = this.splitInstances[splitIndex];
      if (!instance) {
        instance = new Split(zone);
        this.splitInstances[splitIndex] = instance;
      }

      const globalIndex = baseIndex + splitIndex;
      const alreadyVisible = this.isVisible[globalIndex];
      const offset = alreadyVisible ? 0 : OFFSCREEN_TRANSLATE;
      const hasTilt = zone.classList.contains("t-1");
      const rotateSegment =
        hasTilt && !alreadyVisible ? ` rotateX(${TILT_ROTATION}deg)` : "";

      const mode =
        zone instanceof HTMLElement && zone.dataset.split === "br"
          ? ("br" as const)
          : ("auto" as const);

      instance.resize({
        tag: {
          start: `<span class="s__o"><span class="s__i" style="transform: translate3d(0,${offset}%,0)${rotateSegment ? rotateSegment : ""};">`,
          end: "</span></span>",
        },
        mode,
      });
    }
  }

  private prepare(): void {
    this.animationTargets = [];
    this.timelines = [];
    let zoneIndex = -1;

    for (let oIn = 0; oIn < this.opacityZonesLength; oIn += 1) {
      zoneIndex += 1;
      const element = this.opacityZones[oIn];
      if (!element) {
        this.scrollThreshold[zoneIndex] = -1;
        this.isVisible[zoneIndex] = true;
        continue;
      }

      this.animationTargets[zoneIndex] = element;

      if (this.isVisible[zoneIndex]) {
        this.scrollThreshold[zoneIndex] = -1;
        continue;
      }

      const zoneConfig = this.computeZoneConfig(zoneIndex, "opacity");
      const nodes =
        zoneConfig.contentNodes.length > 0
          ? zoneConfig.contentNodes
          : [element];

      for (const node of nodes) {
        const target = node as HTMLElement | null;
        if (!target) continue;
        target.style.opacity = "0";
      }

      zoneConfig.contentNodes = nodes;
      zoneConfig.contentNodeCount = nodes.length;
      zoneConfig.totalNodeCount = nodes.length;

      if (!zoneConfig.contentNodeCount) continue;
      const tls: Anima[] = [];
      for (let i = 0; i < zoneConfig.contentNodeCount; i += 1) {
        const node = zoneConfig.contentNodes[i];

        if (!node) continue;
        const a = new Anima({
          el: node,
          d: this.opacityDuration,
          e: this.opacityEase,
          de: zoneConfig.delay + i * OPACITY_STAGGER,
          p: { o: [0, 1, ""] },
        });

        tls.push(a);
      }

      this.timelines[zoneIndex] = tls;
    }

    for (let sIn = 0; sIn < this.splitZonesLength; sIn += 1) {
      zoneIndex += 1;
      const element = this.splitZones[sIn];
      if (!element) {
        this.scrollThreshold[zoneIndex] = -1;
        this.isVisible[zoneIndex] = true;
        continue;
      }

      this.animationTargets[zoneIndex] = element;

      if (this.isVisible[zoneIndex]) {
        this.scrollThreshold[zoneIndex] = -1;
        continue;
      }

      const zoneConfig = this.computeZoneConfig(zoneIndex, "split");
      if (!zoneConfig.contentNodes.length) {
        const fallbackNodes = queryAll(element, ".s__i");
        zoneConfig.contentNodes = fallbackNodes.length
          ? fallbackNodes
          : [element];
        zoneConfig.contentNodeCount = zoneConfig.contentNodes.length;
        zoneConfig.totalNodeCount = zoneConfig.contentNodeCount;
      }

      const tls: Anima[] = [];
      if (!zoneConfig.contentNodeCount) continue;
      const { contentNodes } = zoneConfig;
      const shortStagger =
        element instanceof HTMLElement && element.classList.contains("s-40");
      const stagger = shortStagger ? 40 : SPLIT_STAGGER;

      for (let index = 0; index < contentNodes.length; index += 1) {
        const node = contentNodes[index] as HTMLElement | null;
        if (!node) continue;
        const props: Record<string, [number, number, string?]> = {
          y: [OFFSCREEN_TRANSLATE, 0, "%"],
        };
        const anima = new Anima({
          el: node,
          d: this.splitDuration,
          e: "oQ",
          de: zoneConfig.delay + index * stagger,
          p: props,
        });
        tls.push(anima);
      }

      this.timelines[zoneIndex] = tls;
    }

    for (let dIn = 0; dIn < this.divZonesLength; dIn += 1) {
      zoneIndex += 1;
      const element = this.divZones[dIn];
      if (!element) {
        this.scrollThreshold[zoneIndex] = -1;
        this.isVisible[zoneIndex] = true;
        continue;
      }

      this.animationTargets[zoneIndex] = element;

      if (this.isVisible[zoneIndex]) {
        this.scrollThreshold[zoneIndex] = -1;
        continue;
      }

      const zoneConfig = this.computeZoneConfig(zoneIndex, "div");
      const nodes =
        zoneConfig.contentNodes.length > 0
          ? zoneConfig.contentNodes
          : [element];

      zoneConfig.contentNodes = nodes;
      zoneConfig.contentNodeCount = nodes.length;
      zoneConfig.totalNodeCount = nodes.length;

      if (!zoneConfig.contentNodeCount) continue;

      const tls: Anima[] = [];
      for (let i = 0; i < zoneConfig.contentNodeCount; i += 1) {
        const node = zoneConfig.contentNodes[i] as HTMLElement | null;
        if (!node) continue;
        node.style.transformOrigin = node.style.transformOrigin || "0% 50%";
        node.style.transform = `${node.style.transform || ""} scaleX(0)`;

        const a = new Anima({
          el: node,
          d: 1000,
          e: "oC",
          de: zoneConfig.delay + i * 300,
          p: { scaleX: [0, 1, ""] },
        });
        tls.push(a);
      }

      this.timelines[zoneIndex] = tls;
    }

    for (let svgIn = 0; svgIn < this.svgZonesLength; svgIn += 1) {
      zoneIndex += 1;
      const element = this.svgZones[svgIn];
      if (!element) {
        this.scrollThreshold[zoneIndex] = -1;
        this.isVisible[zoneIndex] = true;
        continue;
      }

      this.animationTargets[zoneIndex] = element;

      if (this.isVisible[zoneIndex]) {
        this.scrollThreshold[zoneIndex] = -1;
        continue;
      }

      const zoneConfig = this.computeZoneConfig(zoneIndex, "svg");
      const nodes =
        zoneConfig.contentNodes.length > 0
          ? zoneConfig.contentNodes
          : [element];

      zoneConfig.contentNodes = nodes;
      zoneConfig.contentNodeCount = nodes.length;
      zoneConfig.totalNodeCount = nodes.length;

      if (!zoneConfig.contentNodeCount) continue;
      const tls: Anima[] = [];
      for (let i = 0; i < zoneConfig.contentNodeCount; i += 1) {
        const node = zoneConfig.contentNodes[i];

        if (!node) continue;
        const maskObj = Array.from(queryAll(node, "g")).map((g) => {
          const id = g.id;
          const masks = queryAll(g, "defs > mask path");
          return { id, masks };
        });

        const maskAnimas: {
          maskPath: HTMLElement;
          maskTarget: HTMLElement | null;
        }[] = Object.values(maskObj).flatMap((g) => {
          const masks = (g.masks ?? []) as HTMLElement[];

          return masks.map((mask) => {
            const maskPath = mask;

            const startWidth = 0;
            maskPath.dataset.originalStrokeWidth = String(BASE_STROKE_WIDTH);
            maskPath.setAttribute("stroke-width", String(startWidth));

            maskPath.setAttribute("stroke-dasharray", "1");
            maskPath.setAttribute("stroke-dashoffset", "1");

            const maskTarget: HTMLElement | null = node.querySelector(
              `[mask="url(#${maskPath.dataset.id})"]`
            );

            return { maskPath, maskTarget };
          });
        });

        if (maskAnimas.length) {
          const a = new Anima({
            el: window,
            d: 0,
            cb: () => {
              for (let j = 0; j < maskAnimas.length; j += 1) {
                const mask = maskAnimas[j];
                if (!mask) continue;

                const { maskPath } = mask;
                maskPath.classList.add("p");
              }
            },
          });

          tls.push(a);
        }
      }
      this.timelines[zoneIndex] = tls;
    }

    this.totalZoneCount = Math.max(zoneIndex + 1, 0);

    for (let index = 0; index < this.totalZoneCount; index += 1) {
      if (typeof this.isVisible[index] === "undefined") {
        this.isVisible[index] = false;
      }
    }
  }

  private computeZoneConfig(
    zoneIndex: number,
    zoneType: keyof RevealSelectors
  ): ZoneConfig {
    const element = this.animationTargets[zoneIndex] ?? null;
    const fallback: ZoneConfig = {
      contentNodes: [],
      contentNodeCount: 0,
      lineNodes: [],
      lineNodeCount: 0,
      totalNodeCount: 0,
      delay: this.baseDelay,
      isInViewport: true,
    };

    if (!element) {
      this.scrollThreshold[zoneIndex] = -1;
      return fallback;
    }

    // Extract class name from selector (remove leading . and any other selector syntax)
    const selector = this._selectors[zoneType];
    const zoneClassName = selector.replace(/^\./, "").split(/[\s.#[\]:>+~]/)[0] ?? "";

    const windowHeight = this.getViewportHeight();
    const currentScroll = this.getCurrentScroll();

    const rect = bounds(element);
    const relTop = rect?.top ?? 0;
    const absTop = relTop + currentScroll;
    const isInViewport = relTop < windowHeight;

    this.scrollThreshold[zoneIndex] = isInViewport ? -1 : absTop - windowHeight;

    let delay = isInViewport ? this.baseDelay : 0;

    const classSuffixPattern = "-[0-9]?[0-9]";
    const elementClassName =
      element instanceof Element ? (element.getAttribute("class") ?? "") : "";
    const escapedZoneClassName = zoneClassName.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const rangeDelayMatch = elementClassName.match(
      new RegExp(
        `${escapedZoneClassName}${classSuffixPattern}${classSuffixPattern}`
      )
    );

    if (rangeDelayMatch) {
      const [scrollDelay, viewportDelay] = rangeDelayMatch[0]
        .substring(zoneClassName.length + 1)
        .split("-");
      const scrollIndex = parseIndex(scrollDelay);
      const viewportIndex = parseIndex(viewportDelay);
      delay += this.delayStep * (isInViewport ? viewportIndex : scrollIndex);
    } else {
      const baseDelayMatch = elementClassName.match(
        new RegExp(`${escapedZoneClassName}${classSuffixPattern}`)
      );
      if (baseDelayMatch) {
        delay +=
          this.delayStep *
          parseIndex(baseDelayMatch[0].substring(zoneClassName.length + 1));
      }
    }

    const wrapperClass = `${zoneClassName}-w`;
    const wrapperElement =
      element instanceof Element
        ? (element.querySelector(`.${wrapperClass}`) as Element | null)
        : null;

    const root = (wrapperElement ?? element) as Element;
    const childClassName = zoneType === "opacity" ? "o" : "s__i";

    let contentNodes: Element[];
    if (root instanceof Element && root.classList.contains(childClassName)) {
      contentNodes = [root];
    } else {
      contentNodes = queryAll(root, `.${childClassName}`);
    }

    if (!contentNodes.length) {
      contentNodes = [root];
    }

    const config: ZoneConfig = {
      contentNodes,
      contentNodeCount: contentNodes.length,
      lineNodes: [],
      lineNodeCount: 0,
      totalNodeCount: contentNodes.length,
      delay,
      isInViewport,
    };

    return config;
  }

  /**
   * Start the animation loop
   */
  startLoop(): void {
    if (this.raf) return;
    this.raf = new Raf("reveal zone", () => this.loop());
    this.raf.run();
  }

  /**
   * Stop the animation loop
   */
  stopLoop(): void {
    if (!this.raf) return;
    this.raf.stop();
    this.raf = null;
  }

  /**
   * Main animation loop - checks scroll position and triggers animations
   */
  loop(): void {
    if (this.totalZoneCount === 0) return;

    const currentScroll = this.getCurrentScroll();

    for (let index = 0; index < this.totalZoneCount; index += 1) {
      if (this.isVisible[index]) continue;
      const rawThreshold = this.scrollThreshold[index];
      const compareThreshold =
        typeof rawThreshold === "number" ? rawThreshold : -1;

      if (currentScroll > compareThreshold) {
        this.isVisible[index] = true;
        const tlRunner: Anima[] | undefined = this.timelines[index];
        if (!tlRunner || !tlRunner.length) continue;
        const tlLength = tlRunner.length;

        for (let i = 0; i < tlLength; i += 1) {
          tlRunner[i]?.play();
        }
      }
    }
  }
}

export default Reveal;
