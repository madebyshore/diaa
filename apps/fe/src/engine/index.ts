/**
 * Engine barrel — public API for the boot/engine subsystem.
 *
 * Exports only Intro (boot animation). The Loader (WebGPU texture preloader)
 * was removed when WebGPU was deleted from the project; the old installRouter
 * and Transition exports were removed in Phase 03-03 when the legacy routing
 * system (engine/router/) was deleted in favour of the Ctrl-based controller
 * in apps/fe/src/app/controller/.
 */
export { default as Intro } from "@engine/boot/intro";
