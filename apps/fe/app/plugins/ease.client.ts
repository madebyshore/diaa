/**
 * plugins/ease.client.ts — registers GSAP CustomEase curves once, before any
 * page or component can call gsap.to() with a named ease.
 *
 * Nuxt plugins run before page/component setup, so this ordering is
 * guaranteed without an explicit await anywhere else in the app. Client-only
 * (.client.ts suffix) because CustomEase registration has no meaning on the
 * server and GSAP's DOM-touching internals should never run during SSR.
 */
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import { EASES } from "~/gsap/eases";

export default defineNuxtPlugin(() => {
  gsap.registerPlugin(CustomEase);
  for (const [name, curve] of Object.entries(EASES)) {
    if (!CustomEase.get(name)) CustomEase.create(name, curve);
  }
  console.debug("[ease] CustomEase registered:", Object.keys(EASES).join(", "));
});
