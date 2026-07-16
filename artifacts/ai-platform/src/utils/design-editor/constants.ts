// Re-export so components can import from utils
export { DESIGN_TEMPLATE_SCHEMA_VERSION, DESIGN_LIMITS } from "../../state/design-editor/constants";

/** Safe font families available in the editor and backend renderer */
export const SAFE_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Poppins",
  "Montserrat",
  "Nunito",
  "Raleway",
  "Playfair Display",
  "Merriweather",
  "Source Sans Pro",
  "PT Sans",
  "Oswald",
  "Ubuntu",
  "Work Sans",
  "DM Sans",
  "Plus Jakarta Sans",
  "Fira Sans",
  "Noto Sans",
  "Rubik",
  "Space Grotesk",
  "IBM Plex Sans",
  "Josefin Sans",
  "Quicksand",
  "Karla",
] as const;

export type SafeFont = (typeof SAFE_FONTS)[number];

/** Default element sizes when adding new elements */
export const ELEMENT_DEFAULTS = {
  text:    { width: 200, height: 50 },
  image:   { width: 300, height: 300 },
  shape:   { width: 150, height: 150 },
  qrcode:  { width: 150, height: 150 },
  line:    { width: 200, height: 4 },
} as const;

/** Alignment snap threshold in pixels */
export const SNAP_THRESHOLD = 8;

/** Keyboard nudge distance in pixels */
export const NUDGE_DISTANCE = 1;
export const NUDGE_DISTANCE_LARGE = 10;
