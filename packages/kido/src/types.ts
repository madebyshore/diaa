/**
 * Scroll state reported by the Scroller
 */
export interface ScrollState {
  /** Current scroll URL/route */
  url: string;
  /** Current scroll position (interpolated) */
  current: number;
  /** Target scroll position */
  target: number;
  /** Minimum scroll value (usually 0) */
  min: number;
  /** Maximum scroll value */
  max: number;
  /** Progress from 0-1 */
  progress: number;
  /** Scroll mode: virtual (transform-based) or native */
  mode: "virtual" | "native";
  /** Scroll direction */
  direction: "vertical" | "horizontal";
}

/**
 * Legacy scroll event type for compatibility
 */
export type ScrollEvent = ScrollState;

/**
 * Configuration for the Scroller
 */
export interface ScrollerConfig {
  /** Container element for scroll calculations */
  container?: HTMLElement | null;
  /** Damping factor for smooth scrolling (0-1), default 0.09 */
  damping?: number;
  /** Force native scroll mode (useful for mobile) */
  forceNative?: boolean;
  /** Callback when scroll updates (for external renderers like WebGL) */
  onUpdate?: (state: ScrollState) => void;
  /** Callback to get scrollable sections */
  getSections?: () => HTMLElement[];
  /** Callback to check if virtual scroll should be used */
  shouldUseVirtualScroll?: () => boolean;
}

/**
 * Per-route scroll state
 */
export interface RouteScrollState {
  current: number;
  target: number;
  direction: "vertical" | "horizontal";
}

/**
 * Custom selectors for reveal zones
 */
export interface RevealSelectors {
  /** Selector for opacity fade zones (default: ".z__o") */
  opacity?: string;
  /** Selector for split text zones (default: ".z__s") */
  split?: string;
  /** Selector for div scale zones (default: ".z__d") */
  div?: string;
  /** Selector for SVG mask zones (default: ".z__g") */
  svg?: string;
}

/**
 * Configuration for the Reveal system
 */
export interface RevealConfig {
  /** Root element to query zones from (defaults to document) */
  root?: HTMLElement | null;
  /** Base delay for animations in ms */
  delay?: number;
  /** Alternative delay key (legacy support) */
  de?: number;
  /** Flag to use reduced delay step (70ms instead of 100ms) */
  useReducedDelay?: boolean;
  /** Current scroll position getter (for scroll-triggered reveals) */
  getScrollPosition?: () => number;
  /** Viewport height override */
  viewportHeight?: number | (() => number);
  /** Custom selectors for reveal zones */
  selectors?: RevealSelectors;
}
