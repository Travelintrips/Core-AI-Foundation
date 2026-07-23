-- Migration 003: Remove duplicate Gemini provider (id=162, slug=google-gemini)
-- The canonical Google/Gemini provider is id=5, slug=google.
-- This migration deactivates the duplicate and adds a unique slug constraint.

-- Step 1: Redirect any references from the duplicate to the canonical provider
UPDATE ai_platform.ai_models
SET    provider_id = 5
WHERE  provider_id = 162
  AND  NOT EXISTS (
         SELECT 1 FROM ai_platform.ai_models m2
         WHERE m2.provider_id = 5 AND m2.slug = ai_models.slug
       );

-- Step 2: Deactivate models still pointing to the duplicate
UPDATE ai_platform.ai_models
SET    status = 'deprecated'
WHERE  provider_id = 162;

-- Step 3: Mark the duplicate provider as inactive
UPDATE ai_platform.ai_providers
SET    status = 'inactive',
       updated_at = NOW()
WHERE  id = 162
  AND  slug = 'google-gemini';

-- Step 4: Add unique constraint on slug (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_ai_providers_slug'
      AND conrelid = 'ai_platform.ai_providers'::regclass
  ) THEN
    ALTER TABLE ai_platform.ai_providers
      ADD CONSTRAINT uq_ai_providers_slug UNIQUE (slug);
  END IF;
END;
$$;
