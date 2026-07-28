import "@/styles/core.scss";

import { Application } from "./app";

class Pkg {
  private application: Application | null
  constructor() {
    this.application = new Application()
    void this.init();
  }


  private init(): void {
    if (!this.application) {
      console.error('[pkg] Failed to create application')
      return
    }

    this.application.init()
  }
}

new Pkg();
