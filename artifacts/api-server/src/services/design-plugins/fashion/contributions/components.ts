/**
 * components.ts — Fashion Design Plugin
 *
 * Garment component category contributions.
 *
 * Rules:
 *   - All categories live in this plugin contribution ONLY.
 *   - The canvas/core renderer must not be forced to understand fashion component semantics.
 *   - Component options are descriptive vocabulary, not implementation instructions.
 */

import type { ComponentCategoryContribution } from "../types/pluginContracts.js";

export const fashionComponentCategories: ComponentCategoryContribution[] = [
  {
    id: "fashion_component_neckline",
    displayName: "Neckline",
    description: "The garment neckline style defining the neck opening shape and depth.",
    required: true,
    options: [
      { value: "crew",          label: "Crew / Round Neck",        iconHint: "neckline_crew" },
      { value: "v_neck",        label: "V-Neck",                   iconHint: "neckline_v" },
      { value: "scoop",         label: "Scoop Neck",               iconHint: "neckline_scoop" },
      { value: "square",        label: "Square Neck",              iconHint: "neckline_square" },
      { value: "boat",          label: "Boat Neck / Bateau",       iconHint: "neckline_boat" },
      { value: "turtleneck",    label: "Turtleneck / High Neck",   iconHint: "neckline_turtle" },
      { value: "cowl",          label: "Cowl Neck",                iconHint: "neckline_cowl" },
      { value: "off_shoulder",  label: "Off-Shoulder",             iconHint: "neckline_off_shoulder" },
      { value: "halter",        label: "Halter",                   iconHint: "neckline_halter" },
      { value: "strapless",     label: "Strapless / Bandeau",      iconHint: "neckline_strapless" },
      { value: "deep_plunge",   label: "Deep Plunge / Open",       iconHint: "neckline_plunge" },
      { value: "asymmetric",    label: "Asymmetric / One-Shoulder",iconHint: "neckline_asymmetric" },
    ],
  },
  {
    id: "fashion_component_sleeve",
    displayName: "Sleeve",
    description: "Sleeve type, length, and construction style.",
    required: false,
    options: [
      { value: "sleeveless",       label: "Sleeveless",                iconHint: "sleeve_none" },
      { value: "cap",              label: "Cap Sleeve",                iconHint: "sleeve_cap" },
      { value: "short",            label: "Short Sleeve",              iconHint: "sleeve_short" },
      { value: "elbow",            label: "Elbow Length",              iconHint: "sleeve_elbow" },
      { value: "three_quarter",    label: "Three-Quarter Sleeve",      iconHint: "sleeve_3q" },
      { value: "long",             label: "Long Sleeve",               iconHint: "sleeve_long" },
      { value: "bishop",           label: "Bishop / Balloon Sleeve",   iconHint: "sleeve_bishop" },
      { value: "flutter",          label: "Flutter / Ruffle Sleeve",   iconHint: "sleeve_flutter" },
      { value: "bell",             label: "Bell Sleeve",               iconHint: "sleeve_bell" },
      { value: "raglan",           label: "Raglan",                    iconHint: "sleeve_raglan" },
      { value: "dolman",           label: "Dolman / Batwing",          iconHint: "sleeve_dolman" },
      { value: "lantern",          label: "Lantern / Puff Sleeve",     iconHint: "sleeve_lantern" },
    ],
  },
  {
    id: "fashion_component_collar",
    displayName: "Collar",
    description: "Collar style for tops, dresses, and outerwear.",
    required: false,
    options: [
      { value: "none",            label: "No Collar / Collarless",    iconHint: "collar_none" },
      { value: "shirt",           label: "Classic Shirt Collar",      iconHint: "collar_shirt" },
      { value: "spread",          label: "Spread / Wide Collar",      iconHint: "collar_spread" },
      { value: "mandarin",        label: "Mandarin / Band Collar",    iconHint: "collar_mandarin" },
      { value: "peter_pan",       label: "Peter Pan Collar",          iconHint: "collar_peterpan" },
      { value: "chelsea",         label: "Chelsea / Club Collar",     iconHint: "collar_chelsea" },
      { value: "lapel_notch",     label: "Notch Lapel",               iconHint: "collar_notch" },
      { value: "lapel_peak",      label: "Peak Lapel",                iconHint: "collar_peak" },
      { value: "shawl",           label: "Shawl Collar",              iconHint: "collar_shawl" },
      { value: "ruffled",         label: "Ruffled / Jabot Collar",    iconHint: "collar_ruffle" },
      { value: "hoodie",          label: "Hood",                      iconHint: "collar_hood" },
    ],
  },
  {
    id: "fashion_component_pocket",
    displayName: "Pocket",
    description: "Pocket style and placement.",
    required: false,
    options: [
      { value: "none",            label: "No Pocket",               iconHint: "pocket_none" },
      { value: "patch",           label: "Patch Pocket",            iconHint: "pocket_patch" },
      { value: "welt",            label: "Welt / Jetted Pocket",    iconHint: "pocket_welt" },
      { value: "side_seam",       label: "Side Seam / In-Seam",     iconHint: "pocket_seam" },
      { value: "flap",            label: "Flap Pocket",             iconHint: "pocket_flap" },
      { value: "cargo",           label: "Cargo Pocket",            iconHint: "pocket_cargo" },
      { value: "breast",          label: "Breast Pocket",           iconHint: "pocket_breast" },
      { value: "kangaroo",        label: "Kangaroo / Front Pouch",  iconHint: "pocket_kangaroo" },
      { value: "coin",            label: "Coin / Watch Pocket",     iconHint: "pocket_coin" },
    ],
  },
  {
    id: "fashion_component_closure",
    displayName: "Closure",
    description: "Primary garment fastening and closure system.",
    required: true,
    options: [
      { value: "none",            label: "No Closure / Pull-On",    iconHint: "closure_none" },
      { value: "button_front",    label: "Button Front",            iconHint: "closure_button" },
      { value: "button_back",     label: "Button Back",             iconHint: "closure_button_back" },
      { value: "zip_centre_front",label: "Centre Front Zip",        iconHint: "closure_zip_cf" },
      { value: "zip_centre_back", label: "Centre Back Zip",         iconHint: "closure_zip_cb" },
      { value: "zip_side",        label: "Side Zip",                iconHint: "closure_zip_side" },
      { value: "wrap",            label: "Wrap / Self-Tie",         iconHint: "closure_wrap" },
      { value: "snap",            label: "Snap / Press Stud",       iconHint: "closure_snap" },
      { value: "hook_eye",        label: "Hook & Eye",              iconHint: "closure_hook" },
      { value: "drawstring",      label: "Drawstring / Elastic",    iconHint: "closure_drawstring" },
      { value: "lace_up",         label: "Lace-Up / Corset",        iconHint: "closure_lace" },
      { value: "velcro",          label: "Velcro / Touch Fastener", iconHint: "closure_velcro" },
    ],
  },
  {
    id: "fashion_component_trim",
    displayName: "Trim & Embellishment",
    description: "Decorative trims, surface embellishments, and hardware details.",
    required: false,
    options: [
      { value: "none",          label: "No Trim",                    iconHint: "trim_none" },
      { value: "topstitch",     label: "Topstitching",               iconHint: "trim_topstitch" },
      { value: "contrast_stitch",label: "Contrast Stitching",        iconHint: "trim_contrast" },
      { value: "piping",        label: "Piping",                     iconHint: "trim_piping" },
      { value: "frill",         label: "Frill / Ruffle",             iconHint: "trim_frill" },
      { value: "broderie",      label: "Broderie Anglaise",          iconHint: "trim_broderie" },
      { value: "embroidery",    label: "Embroidery",                 iconHint: "trim_embroidery" },
      { value: "print",         label: "Print / Pattern",            iconHint: "trim_print" },
      { value: "beading",       label: "Beading / Sequins",         iconHint: "trim_beading" },
      { value: "lace_trim",     label: "Lace Trim",                  iconHint: "trim_lace" },
      { value: "woven_tape",    label: "Woven Tape / Ribbon",        iconHint: "trim_tape" },
      { value: "metal_hardware",label: "Metal Hardware / Buckles",   iconHint: "trim_hardware" },
    ],
  },
];

/** Lookup component category by ID. */
export function getFashionComponentCategory(
  id: string,
): ComponentCategoryContribution | undefined {
  return fashionComponentCategories.find((c) => c.id === id);
}
