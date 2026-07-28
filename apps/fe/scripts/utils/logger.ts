/**
 * Build Logger
 *
 * Minimal, sleek console output for build process.
 */

// ANSI color codes
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${c.dim}${h}:${m}:${s}${c.reset}`;
}

function tag(name: string): string {
  return `${c.dim}[${name}]${c.reset}`;
}

export const log = {
  /** Section header */
  section(name: string): void {
    console.log(`\n${c.cyan}${c.bold}${name}${c.reset}`);
  },

  /** Tagged log line */
  line(label: string, message: string, detail?: string): void {
    const d = detail ? ` ${c.dim}${detail}${c.reset}` : "";
    console.log(`${timestamp()} ${tag(label)} ${message}${d}`);
  },

  /** Warning */
  warn(label: string, message: string): void {
    console.log(`${timestamp()} ${c.yellow}[${label}]${c.reset} ${message}`);
  },

  /** Error */
  error(label: string, message: string): void {
    console.log(`${timestamp()} ${c.red}[${label}]${c.reset} ${message}`);
  },

  /** Timing result */
  time(label: string, ms: number): void {
    const color = ms < 1000 ? c.green : ms < 3000 ? c.yellow : c.red;
    const formatted = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
    console.log(`${timestamp()} ${tag(label)} ${color}${formatted}${c.reset}`);
  },

  /** Blank line */
  nl(): void {
    console.log();
  },
};

export default log;
