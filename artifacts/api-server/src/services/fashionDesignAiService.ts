/**
 * fashionDesignAiService.ts — Prompt builders for the Fashion Design
 * 5-agent AI pipeline.
 *
 * Pipeline order:
 *   1. fashion-brand-strategist  — Brand DNA, segment, positioning in fashion
 *   2. fashion-creative-director — Collection concept, season, mood board
 *   3. fashion-collection-writer — Collection name, lookbook copy, item descs
 *   4. fashion-trend-analyst     — Trend alignment, market validation
 *   5. fashion-quality-control   — Final QC & scoring
 */

export interface FashionDesignBriefInput {
  brandName:         string;
  fashionSegment:    string; // luxury | streetwear | modest_fashion | casual | sportswear | workwear | kidswear | bridal
  collectionType:    string; // ready_to_wear | capsule | seasonal | limited_edition | custom_order
  targetGender:      string; // women | men | unisex | kids
  season:            string; // ss25 | fw25 | resort | holiday | all_season
  targetMarket:      string;
  pricePoint:        string; // mass_market | mid_range | premium | luxury
  styleInspiration:  string;
  colorDirection:    string;
  fabricPreference:  string;
  numberOfLooks:     string;
  goal:              string;
  notes?:            string | null;
}

// ── 1. Fashion Brand Strategist ───────────────────────────────────────────────

export function buildFashionBrandStrategistPrompt(
  brief: FashionDesignBriefInput,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a Senior Fashion Brand Strategist with 15+ years in Southeast Asia and global fashion markets. You have worked with luxury houses, contemporary brands, and emerging labels. You understand fashion consumer psychology, cultural nuances, trend cycles, and brand DNA building. You craft positioning strategies that translate into compelling collections. Always respond in valid JSON.`;

  const userPrompt = `Develop a comprehensive fashion brand strategy for the following brief:

BRAND NAME: ${brief.brandName}
FASHION SEGMENT: ${brief.fashionSegment}
COLLECTION TYPE: ${brief.collectionType}
TARGET GENDER: ${brief.targetGender}
SEASON: ${brief.season}
TARGET MARKET: ${brief.targetMarket}
PRICE POINT: ${brief.pricePoint}
STYLE INSPIRATION: ${brief.styleInspiration}
GOAL: ${brief.goal}
${brief.notes ? `NOTES: ${brief.notes}` : ""}

Return a JSON object:
{
  "brand_dna": {
    "essence": "one-sentence brand essence",
    "values": ["value1", "value2", "value3"],
    "personality": ["trait1", "trait2", "trait3"],
    "archetype": "e.g. The Creator, The Explorer, The Ruler"
  },
  "positioning": {
    "statement": "positioning statement in fashion context",
    "segment_fit": "why this segment fits the brand",
    "price_justification": "value proposition for the price point",
    "competitive_space": "where the brand sits vs competitors"
  },
  "target_customer": {
    "profile": "detailed customer persona",
    "age_range": "e.g. 25-35",
    "lifestyle": "lifestyle description",
    "shopping_behavior": "how and where they shop",
    "aspiration": "what they want to signal through fashion",
    "pain_points": ["pain1", "pain2"]
  },
  "collection_strategy": {
    "narrative": "the story this collection tells",
    "cultural_references": ["ref1", "ref2"],
    "occasion_fit": "when/where customers wear these pieces",
    "key_silhouettes": ["silhouette1", "silhouette2", "silhouette3"]
  },
  "market_context": {
    "trend_relevance": "how this collection fits current trends",
    "differentiation": "what makes this stand out in the market",
    "growth_opportunity": "market opportunity this addresses"
  },
  "tone_of_voice": "brand communication style for fashion context"
}`;

  return { systemPrompt, userPrompt };
}

// ── 2. Fashion Creative Director ──────────────────────────────────────────────

export function buildFashionCreativeDirectorPrompt(
  brief: FashionDesignBriefInput,
  brandStrategy: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a world-class Fashion Creative Director with experience directing collections for major fashion weeks and premium labels. You translate brand strategy into cohesive collection concepts, mood boards, and visual direction. You understand garment construction, fabric properties, color theory in fashion, and how to create looks that photograph well and sell. Always respond in valid JSON.`;

  const userPrompt = `Create a detailed creative direction for this fashion collection:

BRIEF:
- Brand: ${brief.brandName} (${brief.fashionSegment})
- Collection Type: ${brief.collectionType}
- Season: ${brief.season}
- Target Gender: ${brief.targetGender}
- Color Direction: ${brief.colorDirection}
- Fabric Preference: ${brief.fabricPreference}
- Number of Looks: ${brief.numberOfLooks}
- Style Inspiration: ${brief.styleInspiration}

BRAND STRATEGY:
${JSON.stringify(brandStrategy, null, 2)}

Return a JSON object:
{
  "collection_concept": {
    "title": "collection title/name concept",
    "theme": "central theme in 1-2 sentences",
    "mood": "the emotional atmosphere of the collection",
    "story_arc": "narrative progression from look 1 to final look"
  },
  "color_palette": {
    "hero_colors": [
      { "name": "color name", "hex": "#hexcode", "role": "hero/accent/neutral" }
    ],
    "palette_story": "why these colors work for this season and brand",
    "color_blocking_direction": "how colors should be combined in looks"
  },
  "silhouette_direction": {
    "key_shapes": ["shape1", "shape2", "shape3"],
    "proportion_play": "how volumes and proportions are used",
    "construction_notes": "key construction details to emphasize"
  },
  "fabric_material_direction": {
    "hero_fabrics": ["fabric1", "fabric2"],
    "texture_mix": "how textures should be layered",
    "seasonal_appropriateness": "why these fabrics suit the season"
  },
  "styling_direction": {
    "look_formula": "general formula for building each look",
    "accessories_direction": "bags, shoes, jewelry direction",
    "hair_makeup_reference": "beauty direction to complement collection"
  },
  "visual_references": ["ref1", "ref2", "ref3"],
  "lookbook_art_direction": {
    "setting": "where the lookbook should be shot",
    "lighting": "lighting style",
    "model_direction": "casting and posing notes",
    "photography_style": "e.g. editorial, campaign, street-style"
  }
}`;

  return { systemPrompt, userPrompt };
}

// ── 3. Fashion Collection Writer ──────────────────────────────────────────────

export function buildFashionCollectionWriterPrompt(
  brief: FashionDesignBriefInput,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are an award-winning Fashion Copywriter and Collection Editor. You write collection names, lookbook narratives, product descriptions, press releases, and campaign copy that makes fashion sell. You understand how luxury and contemporary fashion brands communicate — aspirational but accessible, specific but poetic. Always respond in valid JSON.`;

  const userPrompt = `Write all collection copy for this fashion project:

BRAND: ${brief.brandName} | SEGMENT: ${brief.fashionSegment} | SEASON: ${brief.season}
COLLECTION TYPE: ${brief.collectionType} | TARGET: ${brief.targetGender}

BRAND STRATEGY SUMMARY:
${JSON.stringify(brandStrategy, null, 2)}

CREATIVE DIRECTION:
${JSON.stringify(creativeDirection, null, 2)}

Return a JSON object:
{
  "collection_name": {
    "primary": "main collection name",
    "alternatives": ["alt1", "alt2"],
    "name_rationale": "why this name fits"
  },
  "collection_tagline": "short punchy tagline (max 8 words)",
  "collection_statement": "2-3 sentence collection statement for press/buyers",
  "lookbook_intro": "opening paragraph for lookbook (max 80 words, poetic and on-brand)",
  "look_descriptions": [
    {
      "look_number": 1,
      "title": "look title",
      "description": "2-3 sentence description of the look",
      "key_pieces": ["piece1", "piece2"],
      "styling_note": "how to wear/style this look"
    }
  ],
  "product_copy_templates": {
    "hero_piece_description": "template for hero product copy (2-3 sentences)",
    "secondary_piece_description": "template for supporting piece copy",
    "size_fit_note": "sizing/fit language consistent with brand"
  },
  "campaign_copy": {
    "headline": "main campaign headline",
    "subheadline": "secondary headline",
    "body": "2-3 sentence campaign body",
    "cta": "call to action"
  },
  "social_copy": {
    "launch_post": "Instagram launch caption with hashtags",
    "story_teaser": "short teaser for IG/TikTok story",
    "hashtags": ["#tag1", "#tag2", "#tag3"]
  },
  "press_release_opener": "opening paragraph of press release (max 60 words)"
}`;

  return { systemPrompt, userPrompt };
}

// ── 4. Fashion Trend Analyst ──────────────────────────────────────────────────

export function buildFashionTrendAnalystPrompt(
  brief: FashionDesignBriefInput,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
  collectionCopy: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a Senior Fashion Trend Analyst and Market Intelligence Expert. You track runway reports from WGSN, Pantone forecasts, street style data, and consumer behavior in fashion. You evaluate collections against current and upcoming trend cycles and provide actionable market fit analysis. Always respond in valid JSON.`;

  const userPrompt = `Analyze this fashion collection for trend alignment and market fit:

BRAND: ${brief.brandName} | SEGMENT: ${brief.fashionSegment}
SEASON: ${brief.season} | PRICE POINT: ${brief.pricePoint}
MARKET: ${brief.targetMarket}

COLLECTION CONCEPT:
${JSON.stringify(creativeDirection, null, 2)}

COLLECTION COPY:
${JSON.stringify(collectionCopy, null, 2)}

Return a JSON object:
{
  "trend_alignment": {
    "macro_trends": [
      { "trend": "trend name", "relevance": "high/medium/low", "how_collection_taps": "explanation" }
    ],
    "micro_trends": ["specific detail trend 1", "specific detail trend 2"],
    "trend_longevity": "trend cycle position: emerging/peak/saturating/declining",
    "overall_trend_score": 0-100
  },
  "market_fit_analysis": {
    "target_segment_fit": "how well this appeals to stated target",
    "price_point_validation": "is the collection right for the price point?",
    "competitive_landscape": "how this positions vs key competitors",
    "commercial_potential": "high/medium/low with rationale"
  },
  "seasonal_timing": {
    "market_entry_recommendation": "best timing to launch",
    "retail_window": "how long this collection stays relevant",
    "markdown_risk": "low/medium/high — likelihood of needing to discount"
  },
  "strengths": ["commercial strength 1", "commercial strength 2", "commercial strength 3"],
  "risks": ["market risk 1", "market risk 2"],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"]
}`;

  return { systemPrompt, userPrompt };
}

// ── 5. Fashion Quality Control ────────────────────────────────────────────────

export function buildFashionQcPrompt(
  brief: FashionDesignBriefInput,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
  collectionCopy: Record<string, unknown>,
  trendAnalysis: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a Fashion Creative Excellence Director with final approval authority over all collection outputs. You review collections holistically — brand coherence, commercial viability, trend relevance, copy quality, and visual direction — before they go to production or client presentation. Always respond in valid JSON.`;

  const userPrompt = `Perform final quality review of this fashion collection output:

BRIEF: ${brief.brandName} | ${brief.fashionSegment} | ${brief.season}
GOAL: ${brief.goal}

BRAND STRATEGY: ${JSON.stringify(brandStrategy, null, 2)}
CREATIVE DIRECTION: ${JSON.stringify(creativeDirection, null, 2)}
COLLECTION COPY: ${JSON.stringify(collectionCopy, null, 2)}
TREND ANALYSIS: ${JSON.stringify(trendAnalysis, null, 2)}

Return a JSON object:
{
  "overall_score": 0-100,
  "dimension_scores": {
    "brand_coherence": 0-100,
    "commercial_viability": 0-100,
    "trend_relevance": 0-100,
    "copy_quality": 0-100,
    "visual_direction_strength": 0-100
  },
  "collection_readiness": "production_ready | needs_revision | major_rework",
  "strengths": ["strength1", "strength2", "strength3"],
  "critical_issues": [],
  "recommendations": ["improvement1", "improvement2"],
  "approved": true,
  "approval_notes": "summary of review decision"
}`;

  return { systemPrompt, userPrompt };
}
