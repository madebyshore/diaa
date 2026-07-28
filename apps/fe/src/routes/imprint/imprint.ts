/**
 * ImprintPage — manages lifecycle for the /imprint route.
 *
 * Auto-discovered by PageManager via the folder name ("imprint"). All
 * behavior (container fades; the passive title heading + persistent
 * `( Close )` footer need no JS) lives in RichTextPage — Contact and
 * Imprint share it verbatim.
 */

import { RichTextPage } from "@app/primitives/rich-text-page";

export default class ImprintPage extends RichTextPage {
  protected readonly pageKey = "imprint";
}
