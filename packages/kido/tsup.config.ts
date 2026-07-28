import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    tab: "src/tab.ts",
    raf: "src/raf.ts",
    utils: "src/utils.ts",
    svg: "src/svg.ts",
    split: "src/split.ts",
    pointer: "src/pointer.ts",
    wheel: "src/wheel.ts",
    resize: "src/resize.ts",
    anima: "src/anima.ts",
    reveal: "src/reveal.ts",
    scroller: "src/scroller.ts",
    "native-scroller": "src/native-scroller.ts",
    orchestrator: "src/orchestrator.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: true,
  treeshake: true,
  clean: true,
  minify: false,
  sourcemap: true,
  target: "es2020",
  outDir: "dist",
});
