/**
 * Universal Creative Component Library — Component Registry (Team 8)
 *
 * Static in-memory registry of every component type definition.
 * Four domains: Graphic (8 types), Interior (6 types),
 * Fashion (7 types), Packaging (8 types) — 29 types total.
 *
 * This module is pure data — no DB, no I/O.
 */

import type {
  ComponentDefinition,
  ComponentDomain,
  ComponentType,
  PackagingComponentType,
} from "./types.js";

// ── Graphic components ────────────────────────────────────────────────────────

const graphicText: ComponentDefinition = {
  type: "text",
  domain: "graphic",
  name: "Text",
  slug: "graphic-text",
  description: "A styled text block with typography controls.",
  version: "1.0.0",
  supportedDomains: ["graphic", "fashion", "packaging"],
  tags: ["typography", "content", "label"],
  properties: {
    content: { type: "textarea", label: "Content", required: true, maxLength: 2000 },
    fontFamily: { type: "font", label: "Font Family", required: false, default: "Inter" },
    fontSize: { type: "pt", label: "Font Size (pt)", required: false, default: 12, min: 4, max: 300 },
    fontWeight: { type: "enum", label: "Font Weight", required: false, default: "regular",
      options: ["thin", "light", "regular", "medium", "semibold", "bold", "extrabold", "black"] },
    color: { type: "color", label: "Text Color", required: false, default: "#000000" },
    alignment: { type: "enum", label: "Alignment", required: false, default: "left",
      options: ["left", "center", "right", "justify"] },
    lineHeight: { type: "number", label: "Line Height", required: false, default: 1.5, min: 0.8, max: 4 },
    letterSpacing: { type: "number", label: "Letter Spacing (em)", required: false, default: 0, min: -0.1, max: 1 },
    maxWidth: { type: "px", label: "Max Width (px)", required: false, min: 0 },
  },
  constraints: [
    { name: "content_required", description: "Content must not be empty", rule: "required", value: "content" },
    { name: "font_size_min", description: "Font size must be at least 4pt", rule: "min", value: 4 },
  ],
};

const graphicLogo: ComponentDefinition = {
  type: "logo",
  domain: "graphic",
  name: "Logo",
  slug: "graphic-logo",
  description: "Brand logo placement with size and clearance controls.",
  version: "1.0.0",
  supportedDomains: ["graphic", "fashion", "packaging", "interior"],
  tags: ["branding", "image", "identity"],
  properties: {
    imageUrl: { type: "url", label: "Image URL", required: true, description: "PNG/SVG with transparent background preferred" },
    width: { type: "mm", label: "Width (mm)", required: true, min: 5, max: 500 },
    height: { type: "mm", label: "Height (mm)", required: false, description: "Leave blank to auto-scale from width", min: 5, max: 500 },
    preserveAspectRatio: { type: "boolean", label: "Preserve Aspect Ratio", required: false, default: true },
    placement: { type: "enum", label: "Placement", required: false, default: "top-left",
      options: ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right", "center", "custom"] },
    clearance: { type: "mm", label: "Minimum Clearance (mm)", required: false, default: 5, min: 0, max: 50 },
    colorMode: { type: "enum", label: "Color Mode", required: false, default: "full-color",
      options: ["full-color", "monochrome-black", "monochrome-white", "reverse"] },
  },
  constraints: [
    { name: "image_required", description: "Logo image URL is required", rule: "required", value: "imageUrl" },
    { name: "width_required", description: "Width must be specified", rule: "required", value: "width" },
  ],
};

const graphicQr: ComponentDefinition = {
  type: "qr",
  domain: "graphic",
  name: "QR Code",
  slug: "graphic-qr",
  description: "QR code with configurable data, error correction, and styling.",
  version: "1.0.0",
  supportedDomains: ["graphic", "packaging"],
  tags: ["qr", "barcode", "link", "scan"],
  properties: {
    data: { type: "string", label: "QR Data (URL or text)", required: true, maxLength: 2953 },
    size: { type: "mm", label: "Size (mm)", required: false, default: 30, min: 10, max: 200 },
    errorCorrection: { type: "enum", label: "Error Correction Level", required: false, default: "M",
      options: ["L", "M", "Q", "H"], description: "L=7%, M=15%, Q=25%, H=30% damage tolerance" },
    quietZone: { type: "number", label: "Quiet Zone (modules)", required: false, default: 4, min: 0, max: 10 },
    foreground: { type: "color", label: "Foreground Color", required: false, default: "#000000" },
    background: { type: "color", label: "Background Color", required: false, default: "#FFFFFF" },
    includeMargin: { type: "boolean", label: "Include Margin", required: false, default: true },
  },
  constraints: [
    { name: "data_required", description: "QR data must not be empty", rule: "required", value: "data" },
    { name: "data_max_length", description: "QR data cannot exceed 2953 chars", rule: "max", value: 2953 },
  ],
};

const graphicContact: ComponentDefinition = {
  type: "contact",
  domain: "graphic",
  name: "Contact Block",
  slug: "graphic-contact",
  description: "Structured contact information block (name, title, phone, email, address).",
  version: "1.0.0",
  supportedDomains: ["graphic", "packaging"],
  tags: ["contact", "address", "info"],
  properties: {
    fullName: { type: "string", label: "Full Name", required: false, maxLength: 100 },
    title: { type: "string", label: "Job Title", required: false, maxLength: 100 },
    phone: { type: "string", label: "Phone Number", required: false, maxLength: 30 },
    email: { type: "string", label: "Email Address", required: false, maxLength: 254 },
    website: { type: "url", label: "Website URL", required: false },
    address: { type: "textarea", label: "Physical Address", required: false, maxLength: 300 },
    layout: { type: "enum", label: "Layout", required: false, default: "stacked",
      options: ["stacked", "inline", "card", "minimal"] },
    showIcons: { type: "boolean", label: "Show Field Icons", required: false, default: true },
  },
  constraints: [
    { name: "at_least_one_field", description: "At least one contact field is required",
      rule: "custom", value: ["fullName", "phone", "email", "website", "address"] },
  ],
};

const graphicImage: ComponentDefinition = {
  type: "image",
  domain: "graphic",
  name: "Image",
  slug: "graphic-image",
  description: "Generic image placement with fit and border controls.",
  version: "1.0.0",
  supportedDomains: ["graphic", "packaging", "interior"],
  tags: ["image", "photo", "picture"],
  properties: {
    src: { type: "url", label: "Image Source URL", required: true },
    alt: { type: "string", label: "Alt Text", required: false, maxLength: 200 },
    width: { type: "mm", label: "Width (mm)", required: true, min: 1 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 1 },
    objectFit: { type: "enum", label: "Object Fit", required: false, default: "cover",
      options: ["cover", "contain", "fill", "none", "scale-down"] },
    borderRadius: { type: "mm", label: "Border Radius (mm)", required: false, default: 0, min: 0, max: 100 },
    opacity: { type: "number", label: "Opacity (0–1)", required: false, default: 1, min: 0, max: 1 },
  },
  constraints: [
    { name: "src_required", description: "Image source URL is required", rule: "required", value: "src" },
    { name: "dimensions_required", description: "Width and height are required",
      rule: "required", value: ["width", "height"] },
  ],
};

const graphicIcon: ComponentDefinition = {
  type: "icon",
  domain: "graphic",
  name: "Icon",
  slug: "graphic-icon",
  description: "Scalable icon from a supported icon library.",
  version: "1.0.0",
  supportedDomains: ["graphic", "packaging", "fashion"],
  tags: ["icon", "symbol", "glyph"],
  properties: {
    name: { type: "string", label: "Icon Name", required: true, maxLength: 80,
      description: "Icon identifier within the selected library" },
    library: { type: "enum", label: "Icon Library", required: false, default: "heroicons",
      options: ["heroicons", "lucide", "material", "feather", "custom-svg"] },
    size: { type: "px", label: "Size (px)", required: false, default: 24, min: 8, max: 512 },
    color: { type: "color", label: "Color", required: false, default: "#000000" },
    strokeWidth: { type: "number", label: "Stroke Width", required: false, default: 2, min: 0.5, max: 4 },
    customSvgUrl: { type: "url", label: "Custom SVG URL", required: false,
      description: "Required when library is custom-svg" },
  },
  constraints: [
    { name: "name_required", description: "Icon name is required", rule: "required", value: "name" },
    { name: "custom_svg_url", description: "customSvgUrl is required when library is custom-svg",
      rule: "depends_on", relatedFields: ["library", "customSvgUrl"] },
  ],
};

const graphicTable: ComponentDefinition = {
  type: "table",
  domain: "graphic",
  name: "Table",
  slug: "graphic-table",
  description: "Structured data table with configurable columns, rows, and styles.",
  version: "1.0.0",
  supportedDomains: ["graphic", "packaging"],
  tags: ["table", "data", "grid", "list"],
  properties: {
    columns: { type: "json", label: "Column Definitions", required: true,
      description: 'Array of {key, label, width?, align?}' },
    rows: { type: "json", label: "Row Data", required: true,
      description: "Array of row objects keyed by column.key" },
    headerStyle: { type: "json", label: "Header Style", required: false,
      default: { background: "#1a1a1a", color: "#ffffff", fontWeight: "bold" } },
    bodyStyle: { type: "json", label: "Body Style", required: false,
      default: { background: "#ffffff", color: "#000000", alternateBackground: "#f5f5f5" } },
    borderStyle: { type: "enum", label: "Border Style", required: false, default: "solid",
      options: ["none", "solid", "dashed", "dotted"] },
    borderColor: { type: "color", label: "Border Color", required: false, default: "#dddddd" },
    fontSize: { type: "pt", label: "Font Size (pt)", required: false, default: 10, min: 6, max: 24 },
  },
  constraints: [
    { name: "columns_required", description: "At least one column is required", rule: "required", value: "columns" },
    { name: "rows_required", description: "Row data is required", rule: "required", value: "rows" },
  ],
};

const graphicChart: ComponentDefinition = {
  type: "chart",
  domain: "graphic",
  name: "Chart",
  slug: "graphic-chart",
  description: "Data visualisation chart (bar, line, pie, donut, area).",
  version: "1.0.0",
  supportedDomains: ["graphic"],
  tags: ["chart", "graph", "data", "visualisation"],
  properties: {
    chartType: { type: "enum", label: "Chart Type", required: true, default: "bar",
      options: ["bar", "line", "pie", "donut", "area", "scatter", "radar"] },
    data: { type: "json", label: "Chart Data", required: true,
      description: "Array of {label, value} or series format" },
    title: { type: "string", label: "Title", required: false, maxLength: 120 },
    subtitle: { type: "string", label: "Subtitle", required: false, maxLength: 200 },
    colors: { type: "json", label: "Color Palette", required: false,
      default: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"] },
    showLegend: { type: "boolean", label: "Show Legend", required: false, default: true },
    showAxes: { type: "boolean", label: "Show Axes", required: false, default: true },
    width: { type: "px", label: "Width (px)", required: false, default: 600, min: 100, max: 2400 },
    height: { type: "px", label: "Height (px)", required: false, default: 400, min: 100, max: 2400 },
  },
  constraints: [
    { name: "chart_type_required", description: "Chart type must be specified", rule: "required", value: "chartType" },
    { name: "data_required", description: "Chart data is required", rule: "required", value: "data" },
  ],
};

// ── Interior components ───────────────────────────────────────────────────────

const interiorSofa: ComponentDefinition = {
  type: "sofa",
  domain: "interior",
  name: "Sofa",
  slug: "interior-sofa",
  description: "Sofa / seating element with dimensions, material, and configuration.",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["sofa", "seating", "furniture", "living-room"],
  properties: {
    style: { type: "enum", label: "Style", required: true, default: "modern",
      options: ["modern", "classic", "scandinavian", "industrial", "minimalist", "chesterfield", "l-shape", "sectional"] },
    width: { type: "mm", label: "Width (mm)", required: true, min: 600, max: 4000 },
    depth: { type: "mm", label: "Depth (mm)", required: true, min: 400, max: 1500 },
    height: { type: "mm", label: "Height (mm)", required: false, default: 850, min: 500, max: 1200 },
    seatingCapacity: { type: "number", label: "Seating Capacity", required: false, default: 3, min: 1, max: 12 },
    material: { type: "enum", label: "Material", required: false, default: "fabric",
      options: ["fabric", "leather", "velvet", "linen", "faux-leather", "microfiber"] },
    color: { type: "color", label: "Primary Color", required: false, default: "#8B7355" },
    legMaterial: { type: "enum", label: "Leg Material", required: false, default: "wood",
      options: ["wood", "metal", "chrome", "acrylic", "hidden"] },
    hasCushions: { type: "boolean", label: "Has Separate Cushions", required: false, default: true },
  },
  constraints: [
    { name: "width_required", description: "Width is required for floor plan placement", rule: "required", value: "width" },
    { name: "depth_required", description: "Depth is required for floor plan placement", rule: "required", value: "depth" },
  ],
};

const interiorTable: ComponentDefinition = {
  type: "interior_table",
  domain: "interior",
  name: "Table",
  slug: "interior-table",
  description: "Interior table (dining, coffee, side, work) with shape and material.",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["table", "dining", "coffee", "furniture"],
  properties: {
    tableStyle: { type: "enum", label: "Table Style", required: true, default: "dining",
      options: ["dining", "coffee", "side", "work-desk", "console", "outdoor"] },
    shape: { type: "enum", label: "Shape", required: false, default: "rectangular",
      options: ["rectangular", "square", "round", "oval", "custom"] },
    width: { type: "mm", label: "Width (mm)", required: true, min: 200, max: 5000 },
    depth: { type: "mm", label: "Depth (mm)", required: false, min: 200, max: 2000 },
    height: { type: "mm", label: "Height (mm)", required: false, default: 750, min: 300, max: 1200 },
    diameter: { type: "mm", label: "Diameter (mm, for round/oval)", required: false, min: 200, max: 3000 },
    material: { type: "enum", label: "Top Material", required: false, default: "wood",
      options: ["wood", "glass", "marble", "metal", "concrete", "laminate", "stone"] },
    legStyle: { type: "enum", label: "Leg Style", required: false, default: "four-leg",
      options: ["four-leg", "pedestal", "trestle", "hairpin", "sawhorse", "panel"] },
    seatingCapacity: { type: "number", label: "Seating Capacity", required: false, min: 0, max: 30 },
  },
  constraints: [
    { name: "width_required", description: "Width is required", rule: "required", value: "width" },
    { name: "round_needs_diameter", description: "Diameter required for round/oval tables",
      rule: "depends_on", relatedFields: ["shape", "diameter"] },
  ],
};

const interiorLighting: ComponentDefinition = {
  type: "lighting",
  domain: "interior",
  name: "Lighting",
  slug: "interior-lighting",
  description: "Lighting fixture with mount type, output, and colour temperature.",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["lighting", "lamp", "fixture", "ceiling", "floor-lamp"],
  properties: {
    fixtureType: { type: "enum", label: "Fixture Type", required: true, default: "pendant",
      options: ["pendant", "chandelier", "recessed", "track", "wall-sconce", "floor-lamp", "table-lamp", "strip", "spotlight"] },
    mountType: { type: "enum", label: "Mount Type", required: false, default: "ceiling",
      options: ["ceiling", "wall", "floor", "table", "surface", "semi-flush"] },
    wattage: { type: "number", label: "Wattage (W)", required: false, min: 1, max: 2000 },
    lumens: { type: "number", label: "Lumens", required: false, min: 0, max: 50000 },
    colorTemp: { type: "enum", label: "Colour Temperature", required: false, default: "3000K",
      options: ["2700K", "3000K", "3500K", "4000K", "5000K", "6500K", "tunable"] },
    dimmable: { type: "boolean", label: "Dimmable", required: false, default: false },
    diameter: { type: "mm", label: "Diameter (mm)", required: false, min: 50, max: 2000 },
    finishColor: { type: "color", label: "Finish Color", required: false, default: "#C0C0C0" },
    quantity: { type: "number", label: "Quantity", required: false, default: 1, min: 1, max: 100 },
  },
  constraints: [
    { name: "type_required", description: "Fixture type must be specified", rule: "required", value: "fixtureType" },
  ],
};

const interiorCabinet: ComponentDefinition = {
  type: "cabinet",
  domain: "interior",
  name: "Cabinet / Storage",
  slug: "interior-cabinet",
  description: "Storage cabinet, wardrobe, shelving unit with compartment configuration.",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["cabinet", "storage", "wardrobe", "shelving"],
  properties: {
    cabinetStyle: { type: "enum", label: "Cabinet Style", required: true, default: "wardrobe",
      options: ["wardrobe", "kitchen-base", "kitchen-wall", "bookshelf", "display", "filing", "sideboard", "tv-unit"] },
    width: { type: "mm", label: "Width (mm)", required: true, min: 200, max: 6000 },
    depth: { type: "mm", label: "Depth (mm)", required: true, min: 100, max: 900 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 200, max: 3000 },
    doors: { type: "number", label: "Number of Doors", required: false, default: 2, min: 0, max: 20 },
    doorType: { type: "enum", label: "Door Type", required: false, default: "hinged",
      options: ["hinged", "sliding", "bi-fold", "glass", "open", "none"] },
    drawers: { type: "number", label: "Number of Drawers", required: false, default: 0, min: 0, max: 20 },
    shelves: { type: "number", label: "Number of Shelves", required: false, default: 2, min: 0, max: 20 },
    material: { type: "enum", label: "Material", required: false, default: "mdf",
      options: ["mdf", "solid-wood", "plywood", "metal", "glass", "particleboard"] },
    finish: { type: "color", label: "Finish Colour", required: false, default: "#FFFFFF" },
  },
  constraints: [
    { name: "dimensions_required", description: "Width, depth, and height are required", rule: "required",
      value: ["width", "depth", "height"] },
  ],
};

const interiorDoorWindow: ComponentDefinition = {
  type: "door_window",
  domain: "interior",
  name: "Door / Window Zone",
  slug: "interior-door-window",
  description: "Door or window zone marker for floor plan and elevation drawings.",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["door", "window", "opening", "zone"],
  properties: {
    openingType: { type: "enum", label: "Opening Type", required: true, default: "door",
      options: ["door", "window", "sliding-door", "french-door", "bifold-door", "fixed-window", "casement-window", "skylight"] },
    width: { type: "mm", label: "Width (mm)", required: true, min: 300, max: 6000 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 400, max: 4000 },
    sillHeight: { type: "mm", label: "Sill Height from Floor (mm)", required: false, default: 0, min: 0, max: 2000 },
    swingDirection: { type: "enum", label: "Swing Direction (doors)", required: false, default: "inward-left",
      options: ["inward-left", "inward-right", "outward-left", "outward-right", "none"] },
    frameWidth: { type: "mm", label: "Frame Width (mm)", required: false, default: 70, min: 20, max: 300 },
    glazingType: { type: "enum", label: "Glazing Type", required: false, default: "clear",
      options: ["clear", "frosted", "tinted", "opaque", "none"] },
    wallPosition: { type: "enum", label: "Wall Position", required: false, default: "north",
      options: ["north", "south", "east", "west", "custom"] },
  },
  constraints: [
    { name: "type_required", description: "Opening type is required", rule: "required", value: "openingType" },
    { name: "dimensions_required", description: "Width and height are required", rule: "required",
      value: ["width", "height"] },
  ],
};

const interiorDecoration: ComponentDefinition = {
  type: "decoration",
  domain: "interior",
  name: "Decoration / Accent",
  slug: "interior-decoration",
  description: "Decorative accent item (rug, plant, artwork, cushion, vase, etc.).",
  version: "1.0.0",
  supportedDomains: ["interior"],
  tags: ["decoration", "accent", "art", "plant", "rug"],
  properties: {
    category: { type: "enum", label: "Category", required: true, default: "plant",
      options: ["plant", "rug", "artwork", "mirror", "cushion", "throw", "vase", "sculpture", "other"] },
    name: { type: "string", label: "Item Name", required: true, maxLength: 100 },
    width: { type: "mm", label: "Width (mm)", required: false, min: 10 },
    depth: { type: "mm", label: "Depth (mm)", required: false, min: 10 },
    height: { type: "mm", label: "Height (mm)", required: false, min: 10 },
    placement: { type: "enum", label: "Placement", required: false, default: "floor",
      options: ["floor", "wall", "ceiling", "surface", "window"] },
    colorPalette: { type: "json", label: "Colour Palette", required: false,
      description: "Array of hex colour strings" },
    notes: { type: "textarea", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "category_required", description: "Decoration category must be specified", rule: "required", value: "category" },
    { name: "name_required", description: "Item name is required", rule: "required", value: "name" },
  ],
};

// ── Fashion components ────────────────────────────────────────────────────────

const fashionBodyPanel: ComponentDefinition = {
  type: "body_panel",
  domain: "fashion",
  name: "Body Panel",
  slug: "fashion-body-panel",
  description: "Front or back body panel of a garment with fabric and pattern.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["garment", "body", "panel", "fabric"],
  properties: {
    panelSide: { type: "enum", label: "Panel Side", required: true, default: "front",
      options: ["front", "back"] },
    garmentType: { type: "enum", label: "Garment Type", required: true, default: "t-shirt",
      options: ["t-shirt", "polo", "jersey", "hoodie", "jacket", "vest", "shirt", "blouse"] },
    fabricType: { type: "enum", label: "Fabric", required: false, default: "cotton",
      options: ["cotton", "polyester", "cotton-poly-blend", "nylon", "spandex", "wool", "linen", "denim", "fleece"] },
    baseColor: { type: "color", label: "Base Color", required: false, default: "#FFFFFF" },
    pattern: { type: "enum", label: "Pattern", required: false, default: "solid",
      options: ["solid", "striped", "checked", "camouflage", "sublimation", "custom-print"] },
    weight: { type: "enum", label: "Fabric Weight", required: false, default: "medium",
      options: ["lightweight", "medium", "heavyweight"] },
    size: { type: "enum", label: "Size", required: false, default: "M",
      options: ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "custom"] },
    customWidth: { type: "mm", label: "Custom Width (mm)", required: false, min: 200, max: 1000 },
    customLength: { type: "mm", label: "Custom Length (mm)", required: false, min: 300, max: 1200 },
  },
  constraints: [
    { name: "panel_side_required", description: "Panel side (front/back) is required", rule: "required", value: "panelSide" },
    { name: "garment_type_required", description: "Garment type is required", rule: "required", value: "garmentType" },
  ],
};

const fashionSleeve: ComponentDefinition = {
  type: "sleeve",
  domain: "fashion",
  name: "Sleeve",
  slug: "fashion-sleeve",
  description: "Sleeve component with length, cut, and cuff style.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["sleeve", "arm", "garment"],
  properties: {
    sleeveLength: { type: "enum", label: "Sleeve Length", required: true, default: "short",
      options: ["sleeveless", "cap", "short", "elbow", "three-quarter", "long"] },
    sleeveCut: { type: "enum", label: "Sleeve Cut", required: false, default: "set-in",
      options: ["set-in", "raglan", "dolman", "kimono", "drop-shoulder", "puffed"] },
    cuffStyle: { type: "enum", label: "Cuff Style", required: false, default: "ribbed",
      options: ["none", "ribbed", "folded", "button", "elastic", "banded"] },
    cuffWidth: { type: "mm", label: "Cuff Width (mm)", required: false, default: 50, min: 20, max: 200 },
    fabric: { type: "enum", label: "Fabric", required: false, default: "same-as-body",
      options: ["same-as-body", "contrast-fabric", "custom"] },
    contrastColor: { type: "color", label: "Contrast Colour", required: false },
  },
  constraints: [
    { name: "sleeve_length_required", description: "Sleeve length is required", rule: "required", value: "sleeveLength" },
  ],
};

const fashionCollar: ComponentDefinition = {
  type: "collar",
  domain: "fashion",
  name: "Collar",
  slug: "fashion-collar",
  description: "Collar type and finish for shirts, polos, and jackets.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["collar", "neckline", "garment"],
  properties: {
    collarStyle: { type: "enum", label: "Collar Style", required: true, default: "polo",
      options: ["none", "crew-neck", "v-neck", "polo", "button-down", "stand", "spread", "mandarin", "hood", "turtleneck"] },
    collarFabric: { type: "enum", label: "Collar Fabric", required: false, default: "same-as-body",
      options: ["same-as-body", "ribbed", "pique", "woven", "contrast"] },
    collarColor: { type: "color", label: "Collar Color", required: false },
    hasButtons: { type: "boolean", label: "Has Buttons", required: false, default: false },
    buttonCount: { type: "number", label: "Button Count", required: false, default: 2, min: 1, max: 10 },
    collarHeight: { type: "mm", label: "Collar Height (mm)", required: false, default: 35, min: 10, max: 120 },
  },
  constraints: [
    { name: "collar_style_required", description: "Collar style is required", rule: "required", value: "collarStyle" },
  ],
};

const fashionPocket: ComponentDefinition = {
  type: "pocket",
  domain: "fashion",
  name: "Pocket",
  slug: "fashion-pocket",
  description: "Pocket placement with style, position, and size.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["pocket", "garment", "detail"],
  properties: {
    pocketStyle: { type: "enum", label: "Pocket Style", required: true, default: "patch",
      options: ["patch", "welt", "flap", "kangaroo", "chest", "slash", "coin", "zip"] },
    position: { type: "enum", label: "Position", required: false, default: "chest-left",
      options: ["chest-left", "chest-right", "hip-left", "hip-right", "back", "sleeve", "interior"] },
    width: { type: "mm", label: "Width (mm)", required: false, default: 120, min: 50, max: 400 },
    height: { type: "mm", label: "Height (mm)", required: false, default: 130, min: 50, max: 400 },
    hasZip: { type: "boolean", label: "Has Zip", required: false, default: false },
    hasFlap: { type: "boolean", label: "Has Flap", required: false, default: false },
    fabric: { type: "enum", label: "Pocket Fabric", required: false, default: "same-as-body",
      options: ["same-as-body", "contrast", "mesh", "custom"] },
    contrastColor: { type: "color", label: "Contrast Colour", required: false },
  },
  constraints: [
    { name: "style_required", description: "Pocket style is required", rule: "required", value: "pocketStyle" },
  ],
};

const fashionLogoArea: ComponentDefinition = {
  type: "logo_area",
  domain: "fashion",
  name: "Logo Area",
  slug: "fashion-logo-area",
  description: "Dedicated logo/graphic placement zone on a garment.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["logo", "branding", "print", "embroidery"],
  properties: {
    placement: { type: "enum", label: "Placement", required: true, default: "chest-left",
      options: ["chest-left", "chest-right", "chest-center", "back-top", "back-center", "back-bottom",
        "sleeve-left", "sleeve-right", "collar", "hem", "custom"] },
    technique: { type: "enum", label: "Application Technique", required: false, default: "screen-print",
      options: ["screen-print", "embroidery", "heat-transfer", "sublimation", "dtg", "patch", "woven-label"] },
    width: { type: "mm", label: "Width (mm)", required: true, min: 10, max: 500 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 10, max: 500 },
    imageUrl: { type: "url", label: "Artwork URL", required: false },
    colorCount: { type: "number", label: "Colour Count", required: false, default: 1, min: 1, max: 12 },
    stitchCount: { type: "number", label: "Stitch Count (embroidery)", required: false, min: 0 },
  },
  constraints: [
    { name: "placement_required", description: "Placement zone is required", rule: "required", value: "placement" },
    { name: "dimensions_required", description: "Width and height are required", rule: "required",
      value: ["width", "height"] },
  ],
};

const fashionSponsor: ComponentDefinition = {
  type: "sponsor",
  domain: "fashion",
  name: "Sponsor Block",
  slug: "fashion-sponsor",
  description: "Sponsor / partner logo slot on a sports or event garment.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["sponsor", "partner", "branding", "sport"],
  properties: {
    placement: { type: "enum", label: "Placement", required: true, default: "chest-center",
      options: ["chest-left", "chest-right", "chest-center", "back-top", "back-center",
        "sleeve-left", "sleeve-right", "shorts-left", "shorts-right"] },
    tier: { type: "enum", label: "Sponsor Tier", required: false, default: "primary",
      options: ["title", "primary", "secondary", "associate", "supporting"] },
    displayOrder: { type: "number", label: "Display Order", required: false, default: 1, min: 1, max: 20 },
    width: { type: "mm", label: "Width (mm)", required: true, min: 10, max: 300 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 10, max: 200 },
    imageUrl: { type: "url", label: "Sponsor Logo URL", required: false },
    backgroundColor: { type: "color", label: "Background Color", required: false },
    padding: { type: "mm", label: "Padding (mm)", required: false, default: 3, min: 0, max: 20 },
  },
  constraints: [
    { name: "placement_required", description: "Placement zone is required", rule: "required", value: "placement" },
    { name: "dimensions_required", description: "Width and height are required", rule: "required",
      value: ["width", "height"] },
  ],
};

const fashionNameNumber: ComponentDefinition = {
  type: "name_number",
  domain: "fashion",
  name: "Name & Number",
  slug: "fashion-name-number",
  description: "Player name and squad number on sports kit.",
  version: "1.0.0",
  supportedDomains: ["fashion"],
  tags: ["name", "number", "player", "sport", "jersey"],
  properties: {
    playerName: { type: "string", label: "Player Name", required: false, maxLength: 30 },
    squadNumber: { type: "string", label: "Squad Number", required: false, maxLength: 4 },
    namePlacement: { type: "enum", label: "Name Placement", required: false, default: "back-above-number",
      options: ["back-above-number", "back-below-number", "front-chest", "none"] },
    numberPlacement: { type: "enum", label: "Number Placement", required: false, default: "back-center",
      options: ["back-center", "front-center", "front-left", "sleeve"] },
    font: { type: "font", label: "Font", required: false, default: "Athletic" },
    nameSize: { type: "mm", label: "Name Height (mm)", required: false, default: 40, min: 15, max: 100 },
    numberSize: { type: "mm", label: "Number Height (mm)", required: false, default: 180, min: 50, max: 350 },
    textColor: { type: "color", label: "Text Colour", required: false, default: "#FFFFFF" },
    outlineColor: { type: "color", label: "Outline Colour", required: false },
    technique: { type: "enum", label: "Application Technique", required: false, default: "heat-transfer",
      options: ["heat-transfer", "screen-print", "embroidery", "sublimation", "cut-vinyl"] },
  },
  constraints: [
    { name: "at_least_name_or_number", description: "At least player name or squad number must be provided",
      rule: "custom", value: ["playerName", "squadNumber"] },
  ],
};

// ── Packaging components ──────────────────────────────────────────────────────

const makePackagingFace = (
  type: PackagingComponentType,
  name: string,
  description: string,
): ComponentDefinition => ({
  type,
  domain: "packaging",
  name,
  slug: `packaging-${type}`,
  description,
  version: "1.0.0",
  supportedDomains: ["packaging"],
  tags: ["packaging", "face", "panel", type],
  properties: {
    width: { type: "mm", label: "Width (mm)", required: true, min: 10, max: 2000 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 10, max: 2000 },
    bleed: { type: "mm", label: "Bleed (mm)", required: false, default: 3, min: 0, max: 20 },
    safeZone: { type: "mm", label: "Safe Zone Inset (mm)", required: false, default: 5, min: 0, max: 30 },
    backgroundColor: { type: "color", label: "Background Color", required: false, default: "#FFFFFF" },
    contentSlots: { type: "json", label: "Content Slot Definitions", required: false,
      description: 'Array of {id, type, x, y, width, height} — component refs go here' },
    finishType: { type: "enum", label: "Finish Type", required: false, default: "matte",
      options: ["matte", "gloss", "soft-touch", "uv-spot", "foil", "emboss", "none"] },
    dielineRef: { type: "url", label: "Dieline Reference URL", required: false },
  },
  constraints: [
    { name: "dimensions_required", description: "Width and height are required", rule: "required",
      value: ["width", "height"] },
  ],
});

const packagingFront = makePackagingFace("front", "Packaging Front Face", "Primary display face of a packaging unit.");
const packagingBack = makePackagingFace("back", "Packaging Back Face", "Back face, typically for legal/nutritional info.");
const packagingSide = makePackagingFace("side", "Packaging Side Face", "Side face / gusset panel.");
const packagingTop = makePackagingFace("top", "Packaging Top Face", "Top panel / lid of a packaging unit.");
const packagingBottom = makePackagingFace("bottom", "Packaging Bottom Face", "Bottom panel with barcode/legal block zone.");

const packagingLabel: ComponentDefinition = {
  type: "label",
  domain: "packaging",
  name: "Label",
  slug: "packaging-label",
  description: "Pressure-sensitive or shrink label with material and adhesive spec.",
  version: "1.0.0",
  supportedDomains: ["packaging"],
  tags: ["label", "sticker", "packaging"],
  properties: {
    width: { type: "mm", label: "Width (mm)", required: true, min: 10, max: 500 },
    height: { type: "mm", label: "Height (mm)", required: true, min: 10, max: 500 },
    shape: { type: "enum", label: "Label Shape", required: false, default: "rectangle",
      options: ["rectangle", "circle", "oval", "custom"] },
    material: { type: "enum", label: "Label Material", required: false, default: "paper",
      options: ["paper", "bopp", "polyethylene", "polyester", "foil", "shrink-sleeve", "in-mould"] },
    adhesive: { type: "enum", label: "Adhesive Type", required: false, default: "permanent",
      options: ["permanent", "removable", "repositionable", "freezer-grade", "high-tack", "none"] },
    finish: { type: "enum", label: "Finish", required: false, default: "matte",
      options: ["matte", "gloss", "soft-touch", "uv-varnish", "none"] },
    bleed: { type: "mm", label: "Bleed (mm)", required: false, default: 2, min: 0, max: 10 },
    contentSlots: { type: "json", label: "Content Slots", required: false },
    printColors: { type: "enum", label: "Print Colors", required: false, default: "cmyk",
      options: ["cmyk", "pms", "cmyk+pms", "digital", "1-color", "2-color"] },
  },
  constraints: [
    { name: "dimensions_required", description: "Width and height are required", rule: "required",
      value: ["width", "height"] },
  ],
};

const packagingBarcode: ComponentDefinition = {
  type: "barcode",
  domain: "packaging",
  name: "Barcode",
  slug: "packaging-barcode",
  description: "Product barcode (EAN, UPC, Code-128, QR, DataMatrix) with spec.",
  version: "1.0.0",
  supportedDomains: ["packaging"],
  tags: ["barcode", "ean", "upc", "scan", "packaging"],
  properties: {
    barcodeType: { type: "enum", label: "Barcode Type", required: true, default: "EAN-13",
      options: ["EAN-13", "EAN-8", "UPC-A", "UPC-E", "Code-128", "Code-39", "ITF", "QR", "DataMatrix", "PDF417"] },
    value: { type: "string", label: "Barcode Value", required: true, maxLength: 100 },
    width: { type: "mm", label: "Width (mm)", required: false, default: 38, min: 10, max: 200 },
    height: { type: "mm", label: "Height (mm)", required: false, default: 25, min: 5, max: 200 },
    includeText: { type: "boolean", label: "Include Human-Readable Text", required: false, default: true },
    fontSize: { type: "pt", label: "Text Size (pt)", required: false, default: 8, min: 4, max: 14 },
    quietZone: { type: "mm", label: "Quiet Zone (mm)", required: false, default: 3, min: 1, max: 20 },
    foreground: { type: "color", label: "Bar Color", required: false, default: "#000000" },
    background: { type: "color", label: "Background Color", required: false, default: "#FFFFFF" },
  },
  constraints: [
    { name: "type_required", description: "Barcode type is required", rule: "required", value: "barcodeType" },
    { name: "value_required", description: "Barcode value is required", rule: "required", value: "value" },
  ],
};

const packagingLegalBlock: ComponentDefinition = {
  type: "legal_block",
  domain: "packaging",
  name: "Legal Block",
  slug: "packaging-legal-block",
  description: "Mandatory legal / regulatory text block with minimum size requirements.",
  version: "1.0.0",
  supportedDomains: ["packaging"],
  tags: ["legal", "regulatory", "text", "compliance", "packaging"],
  properties: {
    content: { type: "textarea", label: "Legal Text", required: true, maxLength: 5000 },
    placement: { type: "enum", label: "Placement Face", required: false, default: "back",
      options: ["front", "back", "side", "top", "bottom", "any"] },
    minFontSize: { type: "pt", label: "Minimum Font Size (pt)", required: false, default: 6, min: 4, max: 12,
      description: "Regulatory minimum — usually 6pt for food products" },
    fontFamily: { type: "font", label: "Font Family", required: false, default: "Arial" },
    textColor: { type: "color", label: "Text Color", required: false, default: "#000000" },
    backgroundColor: { type: "color", label: "Background Color", required: false },
    columnCount: { type: "number", label: "Columns", required: false, default: 1, min: 1, max: 4 },
    maxWidth: { type: "mm", label: "Max Width (mm)", required: false, min: 20 },
    language: { type: "string", label: "Language Code (ISO 639-1)", required: false, default: "id", maxLength: 5 },
    regulatoryBody: { type: "string", label: "Regulatory Body", required: false, maxLength: 100 },
  },
  constraints: [
    { name: "content_required", description: "Legal text content is required", rule: "required", value: "content" },
    { name: "min_font_size", description: "Minimum font size must be at least 4pt", rule: "min", value: 4 },
  ],
};

// ── Registry Map ───────────────────────────────────────────────────────────────

const REGISTRY: readonly ComponentDefinition[] = [
  // Graphic (8)
  graphicText,
  graphicLogo,
  graphicQr,
  graphicContact,
  graphicImage,
  graphicIcon,
  graphicTable,
  graphicChart,
  // Interior (6)
  interiorSofa,
  interiorTable,
  interiorLighting,
  interiorCabinet,
  interiorDoorWindow,
  interiorDecoration,
  // Fashion (7)
  fashionBodyPanel,
  fashionSleeve,
  fashionCollar,
  fashionPocket,
  fashionLogoArea,
  fashionSponsor,
  fashionNameNumber,
  // Packaging (8)
  packagingFront,
  packagingBack,
  packagingSide,
  packagingTop,
  packagingBottom,
  packagingLabel,
  packagingBarcode,
  packagingLegalBlock,
];

// Build fast-lookup maps once at module load time
const BY_TYPE = new Map<ComponentType, ComponentDefinition>(
  REGISTRY.map((c) => [c.type, c]),
);
const BY_DOMAIN = new Map<ComponentDomain, ComponentDefinition[]>();
for (const comp of REGISTRY) {
  for (const domain of comp.supportedDomains) {
    if (!BY_DOMAIN.has(domain)) BY_DOMAIN.set(domain, []);
    BY_DOMAIN.get(domain)!.push(comp);
  }
}
const BY_SLUG = new Map<string, ComponentDefinition>(
  REGISTRY.map((c) => [c.slug, c]),
);

// ── Public API ────────────────────────────────────────────────────────────────

export function getComponentDefinition(type: ComponentType): ComponentDefinition | undefined {
  return BY_TYPE.get(type);
}

export function getComponentBySlug(slug: string): ComponentDefinition | undefined {
  return BY_SLUG.get(slug);
}

export function listComponentsByDomain(domain: ComponentDomain): ComponentDefinition[] {
  return BY_DOMAIN.get(domain) ?? [];
}

export function listAllComponents(): readonly ComponentDefinition[] {
  return REGISTRY;
}

export function listComponentTypes(): ComponentType[] {
  return REGISTRY.map((c) => c.type);
}

export function isValidComponentType(type: string): type is ComponentType {
  return BY_TYPE.has(type as ComponentType);
}

export function isValidDomain(domain: string): domain is ComponentDomain {
  return BY_DOMAIN.has(domain as ComponentDomain);
}

export function getStats() {
  return {
    total: REGISTRY.length,
    byDomain: {
      graphic: REGISTRY.filter((c) => c.domain === "graphic").length,
      interior: REGISTRY.filter((c) => c.domain === "interior").length,
      fashion: REGISTRY.filter((c) => c.domain === "fashion").length,
      packaging: REGISTRY.filter((c) => c.domain === "packaging").length,
    },
  };
}
