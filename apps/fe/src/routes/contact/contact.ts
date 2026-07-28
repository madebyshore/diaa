/**
 * ContactPage — manages lifecycle for the /contact route.
 *
 * Auto-discovered by PageManager via the folder name ("contact"). All
 * behavior (container fades; the passive title heading + persistent
 * `( Close )` footer need no JS) lives in RichTextPage — Contact and
 * Imprint share it verbatim.
 */

import { RichTextPage } from "@app/primitives/rich-text-page";

export default class ContactPage extends RichTextPage {
  protected readonly pageKey = "contact";
}
