/**
 * interiorDesignAiService.ts — Prompt builders for the Interior Design
 * 5-agent AI pipeline.
 *
 * Pipeline order:
 *   1. interior-concept-architect   — Space concept, style direction, vision
 *   2. interior-space-planner       — Zone layout, flow, functional areas
 *   3. interior-material-specialist — Material spec, finishing, furniture
 *   4. interior-copywriter          — Project proposal, room descriptions
 *   5. interior-quality-control     — Final QC & scoring
 */

import { extractLanguageInstruction } from "./creativeAiService.js";

export interface InteriorDesignBriefInput {
  projectName:       string;
  spaceType:         string; // residential | commercial | hospitality | retail | office | restaurant | cafe
  roomTypes:         string; // e.g. "living room, master bedroom, kitchen"
  totalArea:         string; // in sqm
  designStyle:       string; // japandi | scandinavian | industrial | tropical_modern | mid_century | luxury_classic | minimalist | bohemian | eclectic
  budgetTier:        string; // basic | standard | premium | luxury
  targetUser:        string; // who will use this space
  moodGoal:          string; // e.g. "calm and productive", "warm and welcoming"
  existingElements:  string; // what's already there (furniture, architecture features)
  colorPreference:   string;
  mustHaveFeatures:  string;
  avoidElements:     string;
  notes?:            string | null;
}

// ── 1. Interior Concept Architect ─────────────────────────────────────────────

export function buildInteriorConceptArchitectPrompt(
  brief: InteriorDesignBriefInput,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a Principal Interior Architect and Design Visionary with 20+ years of experience across residential, commercial, and hospitality spaces in Southeast Asia and internationally. You have been featured in Wallpaper*, AD, and Elle Decor. You create transformative spaces that balance aesthetics, functionality, and human psychology. You understand tropical climate design, local craftsmanship integration, and contemporary luxury. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Develop a comprehensive interior design concept for the following project:

PROJECT NAME: ${brief.projectName}
SPACE TYPE: ${brief.spaceType}
ROOM TYPES: ${brief.roomTypes}
TOTAL AREA: ${brief.totalArea} sqm
DESIGN STYLE: ${brief.designStyle}
BUDGET TIER: ${brief.budgetTier}
TARGET USER: ${brief.targetUser}
MOOD GOAL: ${brief.moodGoal}
EXISTING ELEMENTS: ${brief.existingElements}
COLOR PREFERENCE: ${brief.colorPreference}
MUST HAVE: ${brief.mustHaveFeatures}
AVOID: ${brief.avoidElements}

PROJECT COHERENCE RULE:
Treat all listed room types as rooms inside ONE connected property and one
interior design project, not as unrelated standalone jobs. Build one shared
architectural language across the property: consistent flooring and ceiling
logic, a connected material and color palette, coordinated lighting, repeated
joinery/details, and believable sightlines or transitions between rooms.
When multiple rooms are selected, explain how the spaces flow from public to
private areas and how the same house identity is maintained. Never invent a
separate visual identity for each room.
${brief.notes ? `NOTES: ${brief.notes}` : ""}

Return a JSON object:
{
  "design_concept": {
    "title": "concept title (evocative, memorable)",
    "narrative": "2-3 sentence concept story that captures the soul of the space",
    "design_philosophy": "the guiding principle behind every decision",
    "emotional_intent": "how occupants should feel in this space"
  },
  "style_direction": {
    "primary_style": "main design style",
    "style_blend": "how multiple influences are combined",
    "local_cultural_integration": "how Indonesian/local elements are incorporated",
    "contemporary_vs_traditional_balance": "the balance point"
  },
  "spatial_concept": {
    "overall_flow": "how the space connects and moves",
    "focal_points": ["focal point per room/zone"],
    "light_philosophy": "approach to natural and artificial light",
    "indoor_outdoor_connection": "how inside connects to outside (if applicable)"
  },
  "color_concept": {
    "primary_palette": [
      { "name": "color name", "hex": "#hexcode", "application": "walls/furniture/accent" }
    ],
    "accent_colors": [
      { "name": "color name", "hex": "#hexcode" }
    ],
    "palette_mood": "emotional quality of the color story",
    "color_flow_between_rooms": "how colors transition between spaces"
  },
  "signature_elements": ["distinctive design element 1", "element 2", "element 3"],
  "client_lifestyle_alignment": "how the design serves the target user's specific lifestyle"
}`;

  return { systemPrompt, userPrompt };
}

// ── 2. Interior Space Planner ─────────────────────────────────────────────────

export function buildInteriorSpacePlannerPrompt(
  brief: InteriorDesignBriefInput,
  concept: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a Senior Interior Space Planner specialising in functional layout optimization, human ergonomics, and spatial psychology. You create space plans that maximize usability while supporting the design concept. You understand Indonesian building norms, tropical ventilation, and how people actually live and work in spaces. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Create a detailed spatial planning strategy for this interior project:

PROJECT: ${brief.projectName} | TYPE: ${brief.spaceType}
ROOMS: ${brief.roomTypes} | AREA: ${brief.totalArea} sqm
BUDGET: ${brief.budgetTier} | STYLE: ${brief.designStyle}
MUST HAVE: ${brief.mustHaveFeatures}
AVOID: ${brief.avoidElements}

Treat the selected rooms as one connected property. Plan adjacency, sightlines,
transitions, circulation, shared materials, and a consistent design language
across every selected room. Do not return a collection of disconnected room
concepts.

DESIGN CONCEPT:
${JSON.stringify(concept, null, 2)}

Return a JSON object:
{
  "space_planning_strategy": {
    "zoning_principle": "how the space is divided into functional zones",
    "circulation_flow": "movement patterns and corridor logic",
    "privacy_hierarchy": "public to private zone progression"
  },
  "room_by_room_plan": [
    {
      "room": "room name",
      "key_function": "primary purpose",
      "secondary_functions": ["function1", "function2"],
      "recommended_dimensions": "suggested size range",
      "furniture_arrangement": "layout notes",
      "key_features": ["feature1", "feature2"],
      "lighting_zones": ["zone1", "zone2"],
      "storage_strategy": "storage approach for this room"
    }
  ],
  "ergonomic_notes": {
    "traffic_clearances": "minimum clearance recommendations",
    "seating_heights": "recommended heights for context",
    "accessibility_considerations": "any accessibility notes"
  },
  "natural_light_optimization": {
    "window_treatment_direction": "how to handle windows/light",
    "sun_path_consideration": "east/west/north/south orientation notes",
    "ventilation_strategy": "air flow through the space"
  },
  "furniture_placement_principles": ["principle1", "principle2", "principle3"],
  "space_efficiency_tips": ["tip1", "tip2"]
}`;

  return { systemPrompt, userPrompt };
}

// ── 3. Interior Material Specialist ──────────────────────────────────────────

export function buildInteriorMaterialSpecialistPrompt(
  brief: InteriorDesignBriefInput,
  concept: Record<string, unknown>,
  spacePlan: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a Master Interior Material Specialist and Procurement Expert. You have encyclopedic knowledge of materials, finishes, furniture, and fixtures available in Indonesia and internationally. You understand durability, maintenance, climate appropriateness for tropical environments, and how to achieve luxury results across all budget tiers. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Specify materials, finishes, furniture, and fixtures for this interior project:

PROJECT: ${brief.projectName} | STYLE: ${brief.designStyle}
BUDGET: ${brief.budgetTier} | ROOMS: ${brief.roomTypes}
COLOR PREFERENCE: ${brief.colorPreference}

DESIGN CONCEPT:
${JSON.stringify(concept, null, 2)}

SPACE PLAN:
${JSON.stringify(spacePlan, null, 2)}

Return a JSON object:
{
  "flooring": [
    {
      "room": "room name",
      "material": "material name",
      "finish": "matte/gloss/honed/etc",
      "rationale": "why this works",
      "budget_estimate": "price range per m2 in IDR"
    }
  ],
  "wall_treatments": [
    {
      "room": "room name",
      "treatment": "paint/wallpaper/cladding/plaster/etc",
      "color_or_pattern": "specification",
      "accent_wall_direction": "which wall, if any",
      "budget_estimate": "price range"
    }
  ],
  "ceiling_treatment": {
    "approach": "exposed/coffered/dropped/etc",
    "height_recommendation": "recommended ceiling height",
    "detail_notes": "cove lighting, beam treatment, etc"
  },
  "key_furniture": [
    {
      "piece": "furniture name",
      "room": "room",
      "style": "style description",
      "material": "recommended material",
      "local_alternative": "where to source in Indonesia",
      "budget_range": "price range in IDR"
    }
  ],
  "lighting_specification": {
    "ambient_lighting": "general approach",
    "task_lighting": "work/reading light approach",
    "accent_lighting": "decorative/highlight lighting",
    "hero_fixture": "statement lighting piece recommendation"
  },
  "soft_furnishings": {
    "textiles": "curtain, rug, cushion direction",
    "texture_layering": "how to layer textures",
    "pattern_mixing_rule": "how to mix patterns"
  },
  "greenery_biophilic": "plant and natural element integration",
  "artworks_decoratives": "curation direction for art and decorative objects",
  "total_budget_breakdown": {
    "furniture_percentage": "% of total budget",
    "materials_percentage": "% of total budget",
    "lighting_percentage": "% of total budget",
    "soft_furnishings_percentage": "% of total budget",
    "contingency_percentage": "recommended contingency %"
  }
}`;

  return { systemPrompt, userPrompt };
}

// ── 4. Interior Copywriter ────────────────────────────────────────────────────

export function buildInteriorCopywriterPrompt(
  brief: InteriorDesignBriefInput,
  concept: Record<string, unknown>,
  spacePlan: Record<string, unknown>,
  materials: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a specialist Interior Design Copywriter who writes compelling project proposals, design narratives, and client presentations for interior designers and architects. You make spaces sound as beautiful on paper as they will look in reality. You understand how to write for sophisticated clients and how to communicate design value clearly. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Write all copywriting for this interior design project presentation:

PROJECT: ${brief.projectName} | TYPE: ${brief.spaceType}
STYLE: ${brief.designStyle} | BUDGET: ${brief.budgetTier}
MOOD: ${brief.moodGoal}
CLIENT: ${brief.targetUser}

CONCEPT: ${JSON.stringify(concept, null, 2)}
SPACE PLAN: ${JSON.stringify(spacePlan, null, 2)}
MATERIALS: ${JSON.stringify(materials, null, 2)}

Return a JSON object:
{
  "project_title": "evocative project title",
  "project_tagline": "short tagline max 8 words",
  "design_statement": "3-4 sentence design vision statement for client presentation",
  "concept_narrative": "2-3 paragraph poetic narrative about the space (max 200 words)",
  "room_descriptions": [
    {
      "room": "room name",
      "headline": "room headline",
      "description": "2-3 sentence room description"
    }
  ],
  "material_narrative": "1-2 sentence description of the overall material palette",
  "client_proposal_intro": "opening paragraph of the formal design proposal",
  "value_statement": "why this design investment is worth it for the client",
  "design_process_overview": "brief description of the design journey for the client",
  "testimonial_prompt": "suggested testimonial question to ask client post-project",
  "social_media_copy": {
    "project_reveal_caption": "Instagram caption for project reveal",
    "before_after_caption": "caption template for before/after post",
    "hashtags": ["#tag1", "#tag2", "#tag3"]
  }
}`;

  return { systemPrompt, userPrompt };
}

// ── 5. Interior Quality Control ───────────────────────────────────────────────

export function buildInteriorQcPrompt(
  brief: InteriorDesignBriefInput,
  concept: Record<string, unknown>,
  spacePlan: Record<string, unknown>,
  materials: Record<string, unknown>,
  copy: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a Principal Design Director with final review authority over interior design project outputs. You evaluate concepts for coherence, practicality, budget alignment, and client suitability before presentation. You are thorough, constructive, and always focused on elevating the work. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Perform final quality review of this interior design project output:

PROJECT: ${brief.projectName} | STYLE: ${brief.designStyle} | BUDGET: ${brief.budgetTier}
CLIENT: ${brief.targetUser} | MOOD: ${brief.moodGoal}

CONCEPT: ${JSON.stringify(concept, null, 2)}
SPACE PLAN: ${JSON.stringify(spacePlan, null, 2)}
MATERIALS: ${JSON.stringify(materials, null, 2)}
COPY: ${JSON.stringify(copy, null, 2)}

Return a JSON object:
{
  "overall_score": 0-100,
  "dimension_scores": {
    "concept_strength": 0-100,
    "spatial_functionality": 0-100,
    "material_coherence": 0-100,
    "budget_appropriateness": 0-100,
    "copy_quality": 0-100
  },
  "project_readiness": "client_ready | needs_revision | major_rework",
  "strengths": ["strength1", "strength2", "strength3"],
  "critical_issues": [],
  "recommendations": ["improvement1", "improvement2"],
  "approved": true,
  "approval_notes": "summary of review decision"
}`;

  return { systemPrompt, userPrompt };
}
