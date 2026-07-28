# kido

Nice and fast animation & scroll utilities.

## Installation

```bash
npm install kido
# or
pnpm add kido
# or
yarn add kido
```

## Features

- **Smooth Scroll** - Virtual (transform-based) and native scroll with damping
- **Animation Engine** - Timeline-based animations with easing
- **Scroll Reveals** - Trigger animations when elements enter viewport
- **RAF Management** - Centralized requestAnimationFrame hub
- **Text Splitting** - Split text into lines for animation
- **Input Handling** - Unified wheel, keyboard, pointer, and resize events
- **WebGPU Rendering** - Modern GPU rendering with WebGL fallback
- **Post-Processing** - Chainable shader effects (blur, bloom, distortion, etc.)
- **Tree-shakeable** - Import only what you need

## Quick Start

```typescript
import { Scroller, Reveal, Anima } from "kido";

// Create a smooth scroller
const scroller = new Scroller({
  container: document.getElementById("app"),
  damping: 0.09,
  onUpdate: (state) => {
    console.log("Scroll:", state.current);
  },
});

scroller.registerRoute("/");
scroller.setActiveRoute("/");
scroller.start();

// Setup scroll-triggered reveals
const reveal = new Reveal();
reveal.init({
  root: document.getElementById("page"),
  getScrollPosition: () => scroller.current,
});

// Animate an element
const animation = new Anima({
  el: ".my-element",
  d: 800,
  e: "oQ",
  p: { y: [100, 0, "%"], o: [0, 1, ""] },
});
animation.play();
```

## Modules

### Scroller

Smooth scroll manager with virtual (transform-based) and native modes.

```typescript
import { Scroller } from "kido/scroller";

const scroller = new Scroller({
  container: document.getElementById("app"),
  damping: 0.09, // 0-1, higher = snappier
  forceNative: false, // Force native scroll on all devices
  getSections: () => Array.from(document.querySelectorAll(".section")),
  onUpdate: (state) => {
    // Called on every scroll update
    // state: { current, target, min, max, progress, mode, direction }
  },
});

// Register routes for per-page scroll state
scroller.registerRoute("/");
scroller.registerRoute("/about");

// Set active route (resets scroll to top)
scroller.setActiveRoute("/about");

// Control
scroller.start();
scroller.stop();
scroller.pause();
scroller.resume();

// Scroll to position
scroller.scrollTo(500); // Smooth scroll
scroller.scrollTo(500, true); // Immediate jump

// Subscribe to updates
const unsubscribe = scroller.subscribe((state) => {
  console.log(state.current);
});
```

### Reveal

Scroll-triggered animations using CSS class selectors.

```typescript
import { Reveal } from "kido/reveal";

const reveal = new Reveal();
reveal.init({
  root: document.body,
  delay: 200, // Base delay in ms
  getScrollPosition: () => myScroller.current,
});

// Cleanup
reveal.destroy();
```

**Zone Classes:**

- `.z__o` - Opacity fade in
- `.z__s` - Split text animation (word by word)
- `.z__d` - Div scale animation
- `.z__g` - SVG mask reveal

**Delay Modifiers:**

- `.z__o-3` - Add 300ms delay (3 \* 100ms)
- `.z__o-2-5` - 200ms when scrolled in, 500ms when in viewport

### Anima

Timeline-based animation engine.

```typescript
import { Anima } from "kido/anima";

const anim = new Anima({
  el: ".box", // Selector, element, or array
  d: 1000, // Duration in ms
  de: 200, // Delay in ms
  e: "oQ", // Easing preset or [x1, y1, x2, y2]
  p: {
    // Properties to animate
    x: [0, 100, "%"],
    y: [0, 50, "px"],
    o: [0, 1, ""], // Opacity
    rotateX: [0, 45, ""],
    scaleX: [0, 1, ""],
  },
  cb: () => console.log("Done!"),
});

anim.play();
anim.pause();

// Reverse animation
anim.play({ reverse: true });

// Override properties
anim.play({ d: 500, p: { x: { newEnd: 200 } } });
```

**Easing Presets:** `linear`, `o6`, `io6`, `oC`, `oQ`, `o2`, `i1`, `i3`, `o1`, `o3`

### RAF Utilities

```typescript
import { Raf, RafHub, Delay, Timer, getFrameRatio } from "kido/raf";

// Single RAF loop
const raf = new Raf("myLoop", (elapsed) => {
  console.log("Elapsed:", elapsed);
});
raf.run();
raf.stop();

// Delayed callback
const delay = new Delay(() => console.log("Done!"), 500);
delay.run();

// Timer (restartable delay)
const timer = new Timer({ cb: () => console.log("Tick!"), de: 1000 });
timer.run();
timer.run(); // Restarts

// Frame ratio for frame-independent animation
const ratio = getFrameRatio(); // ~1 at 60fps, ~2 at 30fps
```

### Math Utilities

```typescript
import { clamp, lerp, damp, round, Ease, cubicBezier } from "kido/utils";

clamp(150, 0, 100); // 100
lerp(0, 100, 0.5); // 50
damp(current, target, 0.1); // Smooth interpolation
round(3.14159, 2); // 3.14

// Easing
const ease = Ease.oQ; // Preset
const custom = cubicBezier(0.25, 0.1, 0.25, 1);
ease(0.5); // Get eased value at t=0.5
```

### DOM Utilities

```typescript
import { bounds, queryAll, translate3d, Sniff } from "kido/utils";

// Get bounding rect
const rect = bounds(element);

// Query all elements as array
const items = queryAll(document, ".item");

// GPU-accelerated translation
translate3d(element, 0, -100, "px");

// Browser detection
if (Sniff.isMobile) {
  // Mobile/tablet
}
if (Sniff.isFirefox) {
  // Firefox-specific
}
```

### Input Handling

```typescript
import { WheelKeySubscription } from "kido/wheel";
import { PointerMove } from "kido/pointer";
import { ResizeHub } from "kido/resize";

// Wheel + keyboard
const wheel = new WheelKeySubscription({
  cb: (delta) => console.log("Delta:", delta),
  k: false, // Also handle keyboard arrows
});
wheel.on();
wheel.off();

// Pointer tracking
const pointer = new PointerMove({
  cb: (x, y, event) => console.log(x, y),
  el: document.body,
});
pointer.on();
pointer.off();

// Resize observer
const id = ResizeHub.add(() => console.log("Resized!"));
ResizeHub.remove(id);
```

### Text Splitting

```typescript
import { Split } from "kido/split";

const split = new Split(element);
split.resize({
  tag: { start: '<span class="word">', end: "</span>" },
  mode: "auto", // 'auto' or 'br' for explicit line breaks
});
```

### WebGPU Rendering

Modern GPU rendering with automatic WebGL fallback.

```typescript
import { GPURenderer, isWebGPUSupported } from "kido/gpu";

// Check support
if (isWebGPUSupported()) {
  const renderer = new GPURenderer({
    canvas: document.getElementById("canvas"),
    maxPixelRatio: 2,
  });

  // Initialize (async)
  const success = await renderer.init(canvas);

  if (success) {
    // Define a scene with planes
    const scene = {
      planes: [
        {
          texture: myGPUTexture,
          aspectRatio: 16 / 9,
          opacity: 1,
          reveal: 1,
          bounds: { x: 0, y: 0, w: 800, h: 450, z: 1 },
        },
      ],
    };

    // Render
    renderer.render(scene);

    // Request redraw on changes
    renderer.requestRedraw();

    // Cleanup
    renderer.destroy();
  }
}
```

**Texture Loading:**

```typescript
import { loadTexture, createTextureFromImage, createSampler } from "kido/gpu";

// Load from URL
const texture = await loadTexture(device, "/images/hero.webp");

// From existing image element
const texture2 = await createTextureFromImage(device, imgElement);

// Create sampler
const sampler = createSampler(device, {
  filter: "linear",
  addressMode: "clamp-to-edge",
});
```

**Uniform Batching:**

```typescript
import { createUniformBuffer, writeUniform, uploadUniforms } from "kido/gpu";

// Create buffer for batch rendering
const uniformBuffer = createUniformBuffer(device, 100); // max 100 planes

// Write uniform data
writeUniform(uniformBuffer, 0, {
  resolution: [1920, 1080],
  translate: [100, 200, 1],
  scale: [400, 300],
  alpha: 1,
  reveal: 1,
  texAspect: 1.5,
  containerAspect: 1.33,
});

// Upload all at once
uploadUniforms(device, uniformBuffer, planeCount);
```

**Browser Support:**

| Browser     | Status      |
| ----------- | ----------- |
| Chrome 113+ | Stable      |
| Edge 113+   | Stable      |
| Safari 17+  | Partial     |
| Firefox     | Behind flag |

Falls back to WebGL on unsupported browsers.

### Camera

3D camera with perspective/orthographic projection and matrix math utilities.

```typescript
import { Camera, Mat4, Vec3Utils } from "kido/gpu";

const camera = new Camera();

// Auto-resize to match viewport (maps pixel units at z=0 to screen pixels)
camera.resize({ width: 1920, height: 1080 });

// Manual perspective setup
camera.setPerspective(45, 16 / 9, 0.1, 1000);

// Orthographic for 2D rendering
camera.setOrtho2D(1920, 1080);

// Position camera with look-at
camera.lookAt([0, 0, 500], [0, 0, 0], [0, 1, 0]);

// Access matrices for shaders
const projectionMatrix = camera.projection; // Float32Array(16)
const viewMatrix = camera.view; // Float32Array(16)
const viewProjectionMatrix = camera.viewProjection; // Combined

// Matrix utilities
const identity = Mat4.identity();
Mat4.multiply(out, a, b);
Mat4.perspective(out, fovy, aspect, near, far);
Mat4.ortho(out, left, right, bottom, top, near, far);
Mat4.lookAt(out, eye, center, up);

// Vector utilities
const normalized = Vec3Utils.normalize([1, 2, 3]);
const diff = Vec3Utils.subtract([1, 0, 0], [0, 1, 0]);
const crossed = Vec3Utils.cross([1, 0, 0], [0, 1, 0]);
const dotProduct = Vec3Utils.dot([1, 0, 0], [0, 1, 0]);
```

### WebGL Fallback

For browsers without WebGPU support, use the WebGL renderer with the same API.

```typescript
import { GLRenderer, type GLScene, type GLPlane } from "kido/gpu";

// Create WebGL context
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");

const renderer = new GLRenderer(gl, { maxPixelRatio: 2 });
renderer.resize();

// Define scene with planes
const scene: GLScene = {
  planes: [
    {
      texture: myTexture,
      aspectRatio: 16 / 9,
      opacity: 1,
      bounds: { x: 0, y: 0, w: 800, h: 450, z: 1 },
      // Effect properties (auto-eased)
      strength: 0, // Scroll warp strength
      hoverTilt: 0, // Tilt angle (radians)
      hoverZoom: 0, // Zoom scale (0-1)
      reveal: 1, // Bottom-to-top reveal (0-1)
    },
  ],
};

// Render
renderer.renderScene(scene);

// Crossfade between scenes
renderer.renderPair(fromScene, toScene, progress);

// Access camera
const camera = renderer.getCamera();
```

**Shader Effects:**

| Effect      | Property    | Description                                       |
| ----------- | ----------- | ------------------------------------------------- |
| Scroll warp | `strength`  | Sine-wave Z displacement based on scroll momentum |
| Hover tilt  | `hoverTilt` | Rotation around bottom edge (radians)             |
| Hover zoom  | `hoverZoom` | UV zoom effect (0-1 scale)                        |
| Reveal      | `reveal`    | Bottom-to-top mask reveal (0-1)                   |

All effects are automatically eased per-frame for smooth animations.

### Post-Processing

Chainable shader effects using ping-pong buffers for multi-pass rendering.

```typescript
import { PostProcessor, PostPass } from "kido/gpu";

// Import shaders as raw strings (Vite)
import blurShader from "kido/src/gpu/post/shaders/blur.wgsl?raw";
import bloomShader from "kido/src/gpu/post/shaders/bloom.wgsl?raw";

// Create processor
const postProcessor = new PostProcessor({
  device,
  format: navigator.gpu.getPreferredCanvasFormat(),
  width: canvas.width,
  height: canvas.height,
});

// Add passes (order matters - executed in sequence)
const blurPass = postProcessor.addPass({
  name: "blur",
  shaderSource: blurShader,
  uniformBufferSize: 32,
  enabled: true,
});

const bloomPass = postProcessor.addPass({
  name: "bloom",
  shaderSource: bloomShader,
  uniformBufferSize: 32,
  enabled: false, // Toggle at runtime
});

// Render loop
function render() {
  // Update uniforms
  const uniforms = new Float32Array([
    canvas.width,
    canvas.height, // resolution
    time, // time
    blurStrength, // effect param
    1,
    0, // direction (horizontal)
    0,
    0, // padding
  ]);
  blurPass.updateUniforms(device, uniforms.buffer);

  // Render through post-processor
  const encoder = device.createCommandEncoder();
  postProcessor.render(encoder, sourceTextureView, canvasTextureView);
  device.queue.submit([encoder.finish()]);
}

// Handle resize
postProcessor.resize(newWidth, newHeight);

// Cleanup
postProcessor.destroy();
```

**Available Shaders:**

| Shader      | File               | Uniforms                                           |
| ----------- | ------------------ | -------------------------------------------------- |
| Passthrough | `passthrough.wgsl` | resolution, time                                   |
| Distortion  | `distortion.wgsl`  | resolution, time, amount, frequency, speed, mode   |
| RGB Split   | `rgb-split.wgsl`   | resolution, time, amount, angle                    |
| Bloom       | `bloom.wgsl`       | resolution, time, threshold, intensity             |
| Blur        | `blur.wgsl`        | resolution, time, strength, direction              |
| Adjust      | `adjust.wgsl`      | resolution, time, brightness, contrast, saturation |
| Grayscale   | `grayscale.wgsl`   | resolution, time, amount                           |
| Noise       | `noise.wgsl`       | resolution, time, amount                           |
| Pixelate    | `pixelate.wgsl`    | resolution, time, pixelSize                        |

**Creating Custom Shaders:**

```wgsl
struct Uniforms {
  resolution: vec2f,
  time: f32,
  myParam: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOutput {
  // Fullscreen triangle (no vertex buffer needed)
  var pos = array(vec2f(-1,-1), vec2f(-1,3), vec2f(3,-1));
  var out: VSOutput;
  out.position = vec4f(pos[i], 0, 1);
  out.texcoord = pos[i] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

@fragment fn fs(in: VSOutput) -> @location(0) vec4f {
  let color = textureSample(tex, smp, in.texcoord);
  // Apply your effect here
  return color;
}
```

## Tree-shaking

Import from subpaths for optimal bundle size:

```typescript
// Import only what you need
import { Scroller } from "kido/scroller";
import { lerp, clamp } from "kido/utils";
import { Raf } from "kido/raf";
```

## License

MIT
