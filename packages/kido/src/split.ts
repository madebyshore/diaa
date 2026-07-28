import { bounds } from "./utils";

type Token =
  | {
      type: "txt";
      word: string;
    }
  | {
      type: "br";
    }
  | {
      type: "tag";
      start: string;
      end: string;
      word: string[];
    };

type SplitMode = "auto" | "br";

export class Split {
  private el: Element;
  private html: string;
  private tokens: Token[];
  private tokenCount: number;

  constructor(el: HTMLElement) {
    this.el = el;
    this.html = this.el.innerHTML;
    this.tokens = [];
    this.tokenCount = 0;

    const normalised = this.html.replaceAll("</i> <i>", " ");
    const staging = document.createElement("div");
    staging.innerHTML = normalised;

    const nodes = staging.childNodes;
    const nodeLength = nodes.length;

    const tokens: Token[] = [];
    let tokenIndex = 0;

    for (let nIdx = 0; nIdx < nodeLength; nIdx++) {
      const node = nodes[nIdx] as HTMLElement | Text;

      if (node?.nodeType === Node.TEXT_NODE) {
        const words = (node as Text).nodeValue?.split(" ") ?? [];
        const wordCount = words.length;
        for (let wordIdx = 0; wordIdx < wordCount; wordIdx++) {
          const raw = words[wordIdx];
          tokens[tokenIndex++] = {
            type: "txt",
            word: raw === "" ? " " : (raw ?? ""),
          };
        }
        continue;
      }

      const element = node as HTMLElement;
      if (element?.tagName === "BR") {
        tokens[tokenIndex++] = { type: "br" };
        continue;
      }

      if (element?.tagName === "A" || element?.tagName === "I") {
        const outerHTML = element.outerHTML;
        const innerHTML = element.innerHTML;
        const [start, end] = outerHTML.split(`>${innerHTML}<`);
        tokens[tokenIndex++] = {
          type: "tag",
          start: `${start ?? ""}>`,
          end: `<${end ?? ""}`,
          word: innerHTML.split(" "),
        };
      }
    }
    this.tokens = tokens;
    this.tokenCount = tokens.length;
  }

  resize(opts: { tag: { start: string; end: string }; mode?: SplitMode }): void {
    this.el.innerHTML = this.html;

    const mode: SplitMode = opts.mode || "auto";

    if (mode === "br") {
      const lines: string[] = [];
      let lineCount = 0;
      let renderedLine = "";

      for (let idx = 0; idx < this.tokenCount; idx++) {
        const token = this.tokens[idx];
        if (!token) continue;

        if (token.type === "txt") {
          const word = token.word;
          const separator = word === " " ? "" : " ";
          renderedLine += word + separator;
          continue;
        }

        if (token.type === "tag") {
          const { start, end, word } = token;
          const inner = word.join(" ");
          renderedLine += start + inner + end;
          continue;
        }

        if (token.type === "br") {
          lines[lineCount++] = renderedLine.trim();
          renderedLine = "";
        }
      }

      const finalLine = renderedLine.trim();
      if (finalLine && finalLine !== lines[lineCount - 1]) {
        lines[lineCount++] = finalLine;
      }

      const { start, end } = opts.tag;
      let output = "";
      for (let idx = 0; idx < lineCount; idx++) {
        const segment = lines[idx] === "" ? "&nbsp;" : lines[idx];
        output += start + segment + end;
      }

      this.el.innerHTML = output;
      return;
    }

    const maxWidth = this.measure(this.el);
    const probe = document.createElement("div");
    const probeStyle = probe.style;

    probeStyle.visibility = "hidden";
    probeStyle.position = "absolute";
    probeStyle.whiteSpace = "nowrap";

    const computed = getComputedStyle(this.el);
    probeStyle.fontFamily = computed.fontFamily;
    probeStyle.fontSize = computed.fontSize;
    probeStyle.fontWeight = computed.fontWeight;
    probeStyle.letterSpacing = computed.letterSpacing;
    probe.className = "_sl";
    document.body.prepend(probe);

    const textIndent = parseInt(computed.textIndent, 10);
    const hasIndent = textIndent > 0;

    let availableWidth = maxWidth;
    let allowIndent = true;
    if (hasIndent) {
      availableWidth -= textIndent;
      allowIndent = false;
    }

    const lines: string[] = [];
    let lineCount = 0;

    let probePrefix = "";
    let renderedLine = "";

    for (let idx = 0; idx < this.tokenCount; idx++) {
      const token = this.tokens[idx];

      if (hasIndent && !allowIndent && lineCount > 0) {
        allowIndent = true;
        availableWidth += textIndent;
      }

      if (token?.type === "txt") {
        const word = token.word;
        const separator = word === " " ? "" : " ";

        probe.innerHTML = probePrefix + word;
        if (this.measure(probe) > availableWidth) {
          lines[lineCount++] = renderedLine.trim();
          probePrefix = word + separator;
          renderedLine = word + separator;
        } else {
          probePrefix += word + separator;
          renderedLine += word + separator;
        }
        continue;
      }

      if (token?.type === "tag") {
        const { start, end, word } = token;
        const lastWordIndex = word.length - 1;

        probePrefix = this.trimEnd(probePrefix);
        renderedLine = this.trimEnd(renderedLine);

        let accumulator = "";

        for (let wordIdx = 0; wordIdx < word.length; wordIdx++) {
          const suffix = wordIdx === lastWordIndex ? "" : " ";
          const currentWord = word[wordIdx] ?? "";
          accumulator += currentWord;
          probe.innerHTML = probePrefix + start + accumulator + end;
          if (this.measure(probe) > availableWidth) {
            if (wordIdx === 0) {
              lines[lineCount++] = renderedLine.trim();
            } else {
              renderedLine = renderedLine.trim() + end;
              lines[lineCount++] = renderedLine;
            }

            probePrefix = "";
            accumulator = currentWord + suffix;
            renderedLine =
              wordIdx === lastWordIndex
                ? start + currentWord + end + suffix
                : start + currentWord + suffix;
          } else {
            accumulator += suffix;
            let append = currentWord;
            if (wordIdx === 0) append = start + append;
            if (wordIdx === lastWordIndex) append += end;
            renderedLine += append + suffix;
          }

          if (wordIdx === lastWordIndex)
            probePrefix += start + accumulator + end;
        }
        continue;
      }

      if (token?.type === "br") {
        lines[lineCount++] = renderedLine.trim();
        probePrefix = "";
        renderedLine = "";
      }
    }

    const finalLine = renderedLine.trim();
    if (finalLine && finalLine !== lines[lineCount - 1]) {
      lines[lineCount++] = finalLine;
    }

    const { start, end } = opts.tag;
    let output = "";
    for (let idx = 0; idx < lineCount; idx++) {
      const segment = lines[idx] === "" ? "&nbsp;" : lines[idx];
      output += start + segment + end;
    }

    if (probe.parentNode) {
      probe.parentNode.removeChild(probe);
    }
    this.el.innerHTML = output;
  }

  private trimEnd(value: string): string {
    return value.replace(/\s?$/, "");
  }

  private measure(node: Element): number {
    return bounds(node).width;
  }
}

export default Split;
