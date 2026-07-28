import { Reveal } from "kido/reveal";

import Component from "@app/primitives/component";

export class TestComponent extends Component {
  private reveal: Reveal = new Reveal();

  constructor(opts: Record<string, unknown> = {}) {
    super(opts);
    this.componentName = "test";
  }

  init(container: Element | null, selector = ".home-container"): void {
    super.init(container, selector);
    if (!this.section) return;

    this.reveal.init({
      root: this.section as HTMLElement,
    });
  }
}
