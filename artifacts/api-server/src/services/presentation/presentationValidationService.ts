/**
 * presentationValidationService.ts — Phase 4 Presentation Engine
 *
 * Validates a generated PPTX buffer beyond "the extension says .pptx".
 * A PPTX file is a ZIP archive, so validation checks the ZIP signature and
 * the presence of required OOXML entries — this is the same class of check
 * PowerPoint/Google Slides itself performs before treating a file as valid.
 */

import JSZip from "jszip";

export class PresentationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresentationValidationError";
  }
}

export interface PresentationValidationResult {
  valid: boolean;
  slideCount: number;
  fileSizeBytes: number;
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const FORBIDDEN_STRINGS = ["undefined", "null", "[object Object]"];

/**
 * Validate that a Buffer is a genuine, structurally sound PPTX file.
 *
 * @param buffer         Raw PPTX bytes
 * @param expectedSlides The slide count the renderer reported it produced
 * @param minSlides      Minimum acceptable slide count for this presentation type
 */
export async function validateGeneratedPresentation(
  buffer: Buffer,
  expectedSlides: number,
  minSlides: number,
): Promise<PresentationValidationResult> {
  if (!buffer || buffer.length === 0) {
    throw new PresentationValidationError("PPTX buffer is empty");
  }
  if (buffer.length < 2048) {
    throw new PresentationValidationError(`PPTX buffer too small (${buffer.length} bytes) — likely placeholder`);
  }

  // ZIP local-file-header signature: "PK\x03\x04"
  const sig = buffer.slice(0, 4);
  if (!(sig[0] === 0x50 && sig[1] === 0x4b && sig[2] === 0x03 && sig[3] === 0x04)) {
    throw new PresentationValidationError("Buffer is not a valid ZIP/PPTX archive (bad signature)");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new PresentationValidationError(`PPTX is not a readable ZIP archive: ${String(err)}`);
  }

  const requiredEntries = ["[Content_Types].xml", "ppt/presentation.xml"];
  for (const entry of requiredEntries) {
    if (!zip.file(entry)) {
      throw new PresentationValidationError(`PPTX is missing required entry: ${entry}`);
    }
  }

  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (slideFiles.length === 0) {
    throw new PresentationValidationError("PPTX contains no slide XML files");
  }
  if (slideFiles.length < minSlides) {
    throw new PresentationValidationError(
      `PPTX has only ${slideFiles.length} slide(s); expected at least ${minSlides} for this presentation type`,
    );
  }
  if (expectedSlides > 0 && slideFiles.length !== expectedSlides) {
    throw new PresentationValidationError(
      `PPTX slide count mismatch: renderer reported ${expectedSlides} but archive contains ${slideFiles.length}`,
    );
  }

  // Scan slide text content for placeholder markers / stringified-undefined leaks.
  for (const name of slideFiles) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    for (const bad of FORBIDDEN_STRINGS) {
      // Only flag when it appears as literal text content, not as part of a legitimate
      // longer word — a simple substring check is sufficient for this generated XML.
      if (xml.includes(`>${bad}<`) || xml.includes(`>${bad} `) || xml.includes(` ${bad}<`)) {
        throw new PresentationValidationError(`PPTX slide ${name} contains forbidden placeholder text: "${bad}"`);
      }
    }
  }

  const titleTag = zip.file("docProps/core.xml");
  if (!titleTag) {
    throw new PresentationValidationError("PPTX is missing docProps/core.xml (title metadata)");
  }

  return {
    valid: true,
    slideCount: slideFiles.length,
    fileSizeBytes: buffer.length,
    mimeType: PPTX_MIME,
  };
}

export { PPTX_MIME };
