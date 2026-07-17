/**
 * Industry Knowledge Seed Data — Enterprise Template Knowledge Library V5.0
 * 32 industries (top-level + sub-industries) with full taxonomy knowledge.
 */

import type { InsertAiIndustryKnowledge } from "@workspace/db";

export const INDUSTRY_KNOWLEDGE: InsertAiIndustryKnowledge[] = [
  // ── Fashion ────────────────────────────────────────────────────────────────
  {
    industryKey: "fashion", industryName: "Fashion", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "D2C", "Wholesale"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Fashion-forward Millennials", ageRange: "25-40", gender: "All", income: "Middle to High", psychographics: ["trend-aware", "social-media active", "self-expressive"] },
      { name: "Gen Z Style Setters", ageRange: "18-25", gender: "All", income: "Low to Middle", psychographics: ["authentic", "diverse", "digital-native"] },
    ],
    preferredStyles: ["high_fashion", "editorial", "minimalist", "bold", "streetwear"],
    preferredPersonalities: ["innovative", "creative", "bold", "expressive"],
    keywords: ["style", "fashion", "clothing", "apparel", "collection", "season", "designer", "trend", "outfit"],
    sortOrder: 1,
  },
  {
    industryKey: "luxury_fashion", industryName: "Luxury Fashion", parentIndustry: "fashion", level: 2,
    businessTypes: ["D2C", "Flagship", "Wholesale"],
    marketScope: ["national", "global"],
    pricePositioning: ["luxury"],
    targetAudiences: [
      { name: "HNWI Fashion Buyer", ageRange: "30-60", income: "High to Ultra High", psychographics: ["discerning", "status-conscious", "quality-focused"] },
    ],
    preferredStyles: ["luxury", "high_fashion", "editorial", "modern_luxury"],
    preferredPersonalities: ["prestigious", "exclusive", "sophisticated", "timeless"],
    keywords: ["luxury", "haute couture", "designer", "exclusive", "craftsmanship", "heritage", "prestige"],
    sortOrder: 2,
  },
  {
    industryKey: "streetwear_brand", industryName: "Streetwear", parentIndustry: "fashion", level: 2,
    businessTypes: ["D2C", "B2C", "Wholesale"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "premium"],
    targetAudiences: [
      { name: "Urban Youth", ageRange: "16-30", gender: "All", income: "Low to Middle", psychographics: ["authentic", "cultural", "social-identity", "trend-setter"] },
    ],
    preferredStyles: ["streetwear", "bold", "urban", "dark_mode"],
    preferredPersonalities: ["authentic", "rebellious", "cultural", "cool"],
    keywords: ["streetwear", "urban", "hype", "drop", "collab", "limited edition", "culture"],
    sortOrder: 3,
  },
  {
    industryKey: "modest_fashion", industryName: "Modest Fashion", parentIndustry: "fashion", level: 2,
    businessTypes: ["D2C", "B2C", "E-commerce"],
    marketScope: ["national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Modest Fashion Shopper", ageRange: "20-45", gender: "Female", psychographics: ["faith-driven", "style-conscious", "community-oriented"] },
    ],
    preferredStyles: ["elegant", "modern", "feminine", "minimalist"],
    preferredPersonalities: ["modest", "elegant", "faith-aligned", "refined"],
    keywords: ["modest", "hijab", "abaya", "halal fashion", "muslim fashion", "covered", "elegant"],
    sortOrder: 4,
  },
  // ── Beauty ─────────────────────────────────────────────────────────────────
  {
    industryKey: "beauty", industryName: "Beauty & Cosmetics", parentIndustry: null, level: 1,
    businessTypes: ["D2C", "B2C", "B2B"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Beauty Enthusiast", ageRange: "18-40", gender: "Female", psychographics: ["self-care focused", "social-media influenced", "trend-aware"] },
      { name: "Inclusive Beauty Shopper", ageRange: "18-45", gender: "All", psychographics: ["inclusive", "authentic", "representation-conscious"] },
    ],
    preferredStyles: ["feminine", "elegant", "minimalist", "modern_luxury", "editorial"],
    preferredPersonalities: ["innovative", "inclusive", "empowering", "luxurious"],
    keywords: ["beauty", "skincare", "cosmetics", "makeup", "serum", "glow", "clean beauty", "self-care"],
    sortOrder: 5,
  },
  // ── Food & Beverage ────────────────────────────────────────────────────────
  {
    industryKey: "food_beverage", industryName: "Food & Beverage", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B", "D2C"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Food Lover", ageRange: "25-50", gender: "All", psychographics: ["quality-conscious", "experience-seeker", "social diner"] },
      { name: "Health-Conscious Consumer", ageRange: "25-45", psychographics: ["health-aware", "ingredient-conscious", "active lifestyle"] },
    ],
    preferredStyles: ["food_beverage", "organic", "retro", "modern", "scandinavian"],
    preferredPersonalities: ["authentic", "warm", "innovative", "quality-focused"],
    keywords: ["food", "beverage", "restaurant", "cafe", "dining", "cuisine", "fresh", "artisan", "flavor"],
    sortOrder: 6,
  },
  {
    industryKey: "coffee", industryName: "Coffee", parentIndustry: "food_beverage", level: 2,
    businessTypes: ["B2C", "D2C"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "premium"],
    targetAudiences: [
      { name: "Coffee Connoisseur", ageRange: "25-45", psychographics: ["quality-focused", "ritual-oriented", "community-seeking"] },
    ],
    preferredStyles: ["retro", "scandinavian", "organic", "minimalist", "industrial"],
    preferredPersonalities: ["authentic", "artisanal", "community-focused", "quality-obsessed"],
    keywords: ["coffee", "espresso", "specialty", "single origin", "roast", "brew", "barista", "cafe"],
    sortOrder: 7,
  },
  {
    industryKey: "restaurant", industryName: "Restaurant", parentIndustry: "food_beverage", level: 2,
    businessTypes: ["B2C"],
    marketScope: ["local", "national"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Dining Guest", ageRange: "25-55", psychographics: ["experience-seeker", "social", "quality-conscious"] },
    ],
    preferredStyles: ["food_beverage", "elegant", "retro", "modern", "industrial"],
    preferredPersonalities: ["warm", "inviting", "authentic", "quality-focused"],
    keywords: ["restaurant", "dining", "cuisine", "menu", "reservation", "ambience", "chef"],
    sortOrder: 8,
  },
  // ── Technology ─────────────────────────────────────────────────────────────
  {
    industryKey: "technology", industryName: "Technology", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2C", "B2B2C"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "premium", "enterprise"],
    targetAudiences: [
      { name: "Enterprise Decision Maker", ageRange: "35-55", psychographics: ["ROI-focused", "risk-averse", "efficiency-driven"] },
      { name: "Tech-Savvy Professional", ageRange: "25-40", psychographics: ["early adopter", "efficiency-seeking", "innovation-enthusiast"] },
    ],
    preferredStyles: ["modern", "corporate", "glassmorphism", "tech_startup", "dark_mode"],
    preferredPersonalities: ["innovative", "reliable", "professional", "forward-thinking"],
    keywords: ["technology", "software", "platform", "digital", "AI", "cloud", "data", "innovation", "solution"],
    sortOrder: 9,
  },
  {
    industryKey: "saas", industryName: "SaaS", parentIndustry: "technology", level: 2,
    businessTypes: ["B2B", "B2C"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "premium", "enterprise"],
    targetAudiences: [
      { name: "SaaS Buyer", ageRange: "28-50", psychographics: ["productivity-focused", "budget-conscious", "integration-aware"] },
    ],
    preferredStyles: ["modern", "light_mode", "corporate", "tech_startup"],
    preferredPersonalities: ["efficient", "reliable", "innovative", "user-friendly"],
    keywords: ["SaaS", "platform", "subscription", "workflow", "automation", "productivity", "integration"],
    sortOrder: 10,
  },
  {
    industryKey: "fintech", industryName: "Fintech", parentIndustry: "technology", level: 2,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "premium"],
    targetAudiences: [
      { name: "Modern Finance User", ageRange: "25-45", psychographics: ["financially aware", "digital-first", "efficiency-seeking"] },
    ],
    preferredStyles: ["modern", "premium", "glassmorphism", "dark_mode", "corporate"],
    preferredPersonalities: ["trustworthy", "innovative", "secure", "efficient"],
    keywords: ["fintech", "payment", "banking", "investment", "wallet", "financial", "secure", "transfer"],
    sortOrder: 11,
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    industryKey: "finance", industryName: "Finance & Banking", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B", "Institutional"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["mid-market", "premium"],
    targetAudiences: [
      { name: "Wealth Management Client", ageRange: "40-65", income: "High", psychographics: ["stability-focused", "risk-aware", "growth-oriented"] },
      { name: "Retail Banking Customer", ageRange: "25-60", psychographics: ["security-focused", "convenience-seeking"] },
    ],
    preferredStyles: ["premium", "corporate", "classic", "modern"],
    preferredPersonalities: ["trustworthy", "stable", "professional", "competent"],
    keywords: ["finance", "banking", "investment", "wealth", "asset", "capital", "portfolio", "growth"],
    sortOrder: 12,
  },
  // ── Healthcare ─────────────────────────────────────────────────────────────
  {
    industryKey: "healthcare", industryName: "Healthcare", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B", "B2G"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "premium"],
    targetAudiences: [
      { name: "Patient", ageRange: "All", psychographics: ["safety-focused", "trust-seeking", "outcome-oriented"] },
      { name: "Healthcare Professional", ageRange: "25-60", psychographics: ["evidence-based", "efficiency-focused"] },
    ],
    preferredStyles: ["healthcare", "modern", "light_mode", "corporate"],
    preferredPersonalities: ["caring", "professional", "trustworthy", "safe"],
    keywords: ["healthcare", "medical", "health", "patient", "clinic", "hospital", "wellness", "care"],
    sortOrder: 13,
  },
  // ── Real Estate ────────────────────────────────────────────────────────────
  {
    industryKey: "real_estate", industryName: "Real Estate", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Property Buyer", ageRange: "28-55", psychographics: ["investment-minded", "aspirational", "family-oriented"] },
      { name: "Developer Client", ageRange: "30-60", psychographics: ["ROI-focused", "portfolio-building"] },
    ],
    preferredStyles: ["modern", "premium", "luxury", "modern_luxury", "corporate"],
    preferredPersonalities: ["trustworthy", "aspirational", "professional", "quality-focused"],
    keywords: ["real estate", "property", "developer", "investment", "location", "home", "residence", "commercial"],
    sortOrder: 14,
  },
  // ── Logistics ──────────────────────────────────────────────────────────────
  {
    industryKey: "logistics", industryName: "Logistics & Supply Chain", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "enterprise"],
    targetAudiences: [
      { name: "Supply Chain Manager", ageRange: "30-55", psychographics: ["efficiency-focused", "reliability-seeking", "cost-conscious"] },
    ],
    preferredStyles: ["corporate", "modern", "industrial", "premium"],
    preferredPersonalities: ["reliable", "efficient", "professional", "trustworthy"],
    keywords: ["logistics", "supply chain", "shipping", "freight", "delivery", "warehouse", "distribution", "tracking"],
    sortOrder: 15,
  },
  // ── Manufacturing ──────────────────────────────────────────────────────────
  {
    industryKey: "manufacturing", industryName: "Manufacturing", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "enterprise"],
    targetAudiences: [
      { name: "Procurement Manager", ageRange: "30-55", psychographics: ["quality-focused", "reliability-seeking", "cost-efficient"] },
    ],
    preferredStyles: ["industrial", "corporate", "modern", "premium"],
    preferredPersonalities: ["reliable", "quality-focused", "professional", "efficient"],
    keywords: ["manufacturing", "production", "industrial", "factory", "machinery", "quality", "precision"],
    sortOrder: 16,
  },
  // ── Education ──────────────────────────────────────────────────────────────
  {
    industryKey: "education", industryName: "Education", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B", "B2G"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Student", ageRange: "5-25", psychographics: ["curious", "ambitious", "future-focused"] },
      { name: "Parent Decision Maker", ageRange: "28-50", psychographics: ["quality-seeking", "outcome-focused", "trust-driven"] },
    ],
    preferredStyles: ["education", "playful", "modern", "corporate", "scandinavian"],
    preferredPersonalities: ["inspiring", "accessible", "trusted", "innovative"],
    keywords: ["education", "learning", "school", "university", "course", "knowledge", "academic", "study"],
    sortOrder: 17,
  },
  // ── Construction ───────────────────────────────────────────────────────────
  {
    industryKey: "construction", industryName: "Construction", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G", "B2C"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "enterprise"],
    targetAudiences: [
      { name: "Property Developer", ageRange: "35-60", psychographics: ["project-focused", "quality-minded", "timeline-sensitive"] },
    ],
    preferredStyles: ["industrial", "corporate", "modern", "premium"],
    preferredPersonalities: ["reliable", "strong", "professional", "quality-focused"],
    keywords: ["construction", "building", "infrastructure", "project", "engineering", "development", "contractor"],
    sortOrder: 18,
  },
  // ── Automotive ─────────────────────────────────────────────────────────────
  {
    industryKey: "automotive", industryName: "Automotive", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Car Buyer", ageRange: "25-60", psychographics: ["aspiration-driven", "performance-focused", "status-conscious"] },
    ],
    preferredStyles: ["masculine", "premium", "modern", "industrial", "bold"],
    preferredPersonalities: ["powerful", "innovative", "prestigious", "dynamic"],
    keywords: ["automotive", "vehicle", "car", "performance", "drive", "engine", "design", "mobility"],
    sortOrder: 19,
  },
  // ── Hotel & Travel ─────────────────────────────────────────────────────────
  {
    industryKey: "hotel", industryName: "Hotel & Hospitality", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Luxury Traveler", ageRange: "30-65", income: "High", psychographics: ["experience-seeker", "comfort-focused", "exclusive"] },
      { name: "Business Traveler", ageRange: "28-55", psychographics: ["efficiency-focused", "reliability-seeking"] },
    ],
    preferredStyles: ["luxury", "elegant", "modern_luxury", "premium", "organic"],
    preferredPersonalities: ["welcoming", "prestigious", "sophisticated", "warm"],
    keywords: ["hotel", "hospitality", "resort", "accommodation", "luxury", "stay", "experience", "concierge"],
    sortOrder: 20,
  },
  {
    industryKey: "travel", industryName: "Travel & Tourism", parentIndustry: "hotel", level: 2,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Adventure Traveler", ageRange: "25-45", psychographics: ["experience-seeker", "adventurous", "authentic"] },
    ],
    preferredStyles: ["modern", "bold", "organic", "editorial", "contemporary"],
    preferredPersonalities: ["adventurous", "inspiring", "authentic", "exciting"],
    keywords: ["travel", "tourism", "destination", "adventure", "explore", "journey", "culture", "experience"],
    sortOrder: 21,
  },
  // ── Agriculture ────────────────────────────────────────────────────────────
  {
    industryKey: "agriculture", industryName: "Agriculture", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2C", "B2G"],
    marketScope: ["local", "national"],
    pricePositioning: ["budget", "mid-market"],
    targetAudiences: [
      { name: "Farmer / Agribusiness", ageRange: "25-60", psychographics: ["practical", "community-focused", "quality-driven"] },
    ],
    preferredStyles: ["organic", "scandinavian", "modern", "industrial"],
    preferredPersonalities: ["authentic", "reliable", "sustainable", "community-focused"],
    keywords: ["agriculture", "farm", "crop", "harvest", "agribusiness", "food production", "sustainable"],
    sortOrder: 22,
  },
  // ── Mining & Energy ────────────────────────────────────────────────────────
  {
    industryKey: "mining", industryName: "Mining", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G"],
    marketScope: ["national", "global"],
    pricePositioning: ["enterprise"],
    targetAudiences: [
      { name: "Mining Executive", ageRange: "35-60", psychographics: ["ROI-driven", "safety-conscious", "operational-focused"] },
    ],
    preferredStyles: ["industrial", "corporate", "premium"],
    preferredPersonalities: ["reliable", "powerful", "professional", "safety-focused"],
    keywords: ["mining", "resources", "extraction", "minerals", "safety", "operations", "industrial"],
    sortOrder: 23,
  },
  {
    industryKey: "energy", industryName: "Energy", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G", "B2C"],
    marketScope: ["national", "global"],
    pricePositioning: ["mid-market", "enterprise"],
    targetAudiences: [
      { name: "Energy Sector Decision Maker", ageRange: "35-60", psychographics: ["sustainability-aware", "ROI-focused", "regulatory-minded"] },
    ],
    preferredStyles: ["industrial", "corporate", "modern", "organic"],
    preferredPersonalities: ["reliable", "innovative", "sustainable", "powerful"],
    keywords: ["energy", "power", "renewable", "solar", "oil", "gas", "electricity", "sustainability"],
    sortOrder: 24,
  },
  // ── Government ─────────────────────────────────────────────────────────────
  {
    industryKey: "government", industryName: "Government & Public Sector", parentIndustry: null, level: 1,
    businessTypes: ["B2G", "B2C"],
    marketScope: ["local", "national"],
    pricePositioning: ["budget", "mid-market"],
    targetAudiences: [
      { name: "Citizen", ageRange: "All", psychographics: ["service-seeking", "trust-needing", "diverse"] },
    ],
    preferredStyles: ["government", "classic", "corporate", "modern"],
    preferredPersonalities: ["authoritative", "trustworthy", "accessible", "formal"],
    keywords: ["government", "public", "service", "policy", "ministry", "national", "official", "citizen"],
    sortOrder: 25,
  },
  // ── NGO ────────────────────────────────────────────────────────────────────
  {
    industryKey: "ngo", industryName: "NGO & Nonprofit", parentIndustry: null, level: 1,
    businessTypes: ["Nonprofit", "B2G"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget"],
    targetAudiences: [
      { name: "Donor", ageRange: "25-65", psychographics: ["cause-driven", "empathetic", "community-minded"] },
      { name: "Beneficiary", ageRange: "All", psychographics: ["in need", "community-based"] },
    ],
    preferredStyles: ["ngo_social", "organic", "modern", "education"],
    preferredPersonalities: ["empathetic", "purposeful", "hopeful", "transparent"],
    keywords: ["NGO", "nonprofit", "charity", "impact", "community", "mission", "social", "humanitarian"],
    sortOrder: 26,
  },
  // ── Entertainment ──────────────────────────────────────────────────────────
  {
    industryKey: "entertainment", industryName: "Entertainment & Media", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Mass Audience", ageRange: "15-55", psychographics: ["entertainment-seeking", "escapism", "community"] },
    ],
    preferredStyles: ["bold", "editorial", "contemporary", "dark_mode", "glassmorphism"],
    preferredPersonalities: ["exciting", "creative", "dynamic", "engaging"],
    keywords: ["entertainment", "media", "content", "streaming", "film", "music", "game", "show", "experience"],
    sortOrder: 27,
  },
  // ── Sports ─────────────────────────────────────────────────────────────────
  {
    industryKey: "sports", industryName: "Sports", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "Sports Fan", ageRange: "15-50", gender: "All", psychographics: ["passionate", "tribal", "performance-admiring"] },
      { name: "Athlete", ageRange: "15-40", psychographics: ["performance-driven", "competitive", "team-oriented"] },
    ],
    preferredStyles: ["sportswear", "bold", "masculine", "contemporary"],
    preferredPersonalities: ["energetic", "dynamic", "passionate", "winning"],
    keywords: ["sports", "team", "performance", "athlete", "game", "competition", "championship", "fan"],
    sortOrder: 28,
  },
  // ── Interior Design ────────────────────────────────────────────────────────
  {
    industryKey: "interior_design", industryName: "Interior Design", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "B2B"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Homeowner", ageRange: "28-55", psychographics: ["aesthetic-driven", "quality-focused", "aspirational"] },
      { name: "Developer Client", ageRange: "30-60", psychographics: ["project-focused", "ROI-minded"] },
    ],
    preferredStyles: ["japandi", "scandinavian", "minimalist", "luxury", "modern_luxury", "modern"],
    preferredPersonalities: ["aesthetic", "quality-focused", "innovative", "sophisticated"],
    keywords: ["interior design", "space", "decor", "furniture", "residential", "commercial", "concept", "mood"],
    sortOrder: 29,
  },
  // ── Consulting ─────────────────────────────────────────────────────────────
  {
    industryKey: "consulting", industryName: "Consulting & Professional Services", parentIndustry: null, level: 1,
    businessTypes: ["B2B", "B2G"],
    marketScope: ["national", "global"],
    pricePositioning: ["premium", "enterprise"],
    targetAudiences: [
      { name: "C-Suite Executive", ageRange: "38-60", psychographics: ["results-driven", "strategic", "quality-focused"] },
    ],
    preferredStyles: ["premium", "corporate", "modern", "classic"],
    preferredPersonalities: ["authoritative", "trustworthy", "strategic", "expert"],
    keywords: ["consulting", "strategy", "advisory", "transformation", "expertise", "solution", "management"],
    sortOrder: 30,
  },
  // ── Retail ─────────────────────────────────────────────────────────────────
  {
    industryKey: "retail", industryName: "Retail", parentIndustry: null, level: 1,
    businessTypes: ["B2C", "D2C"],
    marketScope: ["local", "national", "global"],
    pricePositioning: ["budget", "mid-market", "premium"],
    targetAudiences: [
      { name: "General Consumer", ageRange: "18-55", psychographics: ["value-seeking", "convenience-oriented", "brand-aware"] },
    ],
    preferredStyles: ["modern", "bold", "contemporary", "playful", "minimalist"],
    preferredPersonalities: ["friendly", "value-focused", "approachable", "reliable"],
    keywords: ["retail", "store", "shop", "product", "brand", "customer", "sale", "shopping"],
    sortOrder: 31,
  },
  // ── Wedding ────────────────────────────────────────────────────────────────
  {
    industryKey: "wedding", industryName: "Wedding", parentIndustry: null, level: 1,
    businessTypes: ["B2C"],
    marketScope: ["local", "national"],
    pricePositioning: ["mid-market", "premium", "luxury"],
    targetAudiences: [
      { name: "Engaged Couple", ageRange: "22-40", psychographics: ["romantic", "milestone-focused", "detail-oriented"] },
    ],
    preferredStyles: ["elegant", "feminine", "luxury", "minimalist", "organic"],
    preferredPersonalities: ["romantic", "graceful", "timeless", "sophisticated"],
    keywords: ["wedding", "bridal", "ceremony", "love", "celebration", "venue", "flowers", "romance"],
    sortOrder: 32,
  },
];
