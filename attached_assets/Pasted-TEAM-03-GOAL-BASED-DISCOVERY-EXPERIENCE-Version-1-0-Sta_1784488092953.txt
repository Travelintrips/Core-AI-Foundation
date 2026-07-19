TEAM-03 — GOAL-BASED DISCOVERY EXPERIENCE

Version: 1.0
Status: ACTIVE

Assigned branch:

feature/v4.2d-discovery-experience

Target integration branch:

integration/v4.2

==================================================
CRITICAL BRANCH GATE — EXECUTE BEFORE EVERYTHING
==================================================

This branch check is mandatory.

Do not inspect application source code.
Do not edit files.
Do not create files.
Do not install dependencies.
Do not run database migrations.
Do not start implementation.
Do not make commits.

First run exactly:

git fetch origin
git branch --show-current
git status --short
git rev-parse --short HEAD
git branch -a

Print the results.

The implementation is forbidden while the active branch is:

main

or:

integration/v4.2

or any branch other than:

feature/v4.2d-discovery-experience

==================================================
BRANCH PREPARATION
==================================================

Check whether the remote integration branch exists:

git show-ref --verify --quiet refs/remotes/origin/integration/v4.2

If origin/integration/v4.2 does not exist:

STOP.

Report:

BLOCKED — origin/integration/v4.2 does not exist.

Do not silently use origin/main.
Do not create the feature branch from local main.
Do not continue implementation.

If origin/integration/v4.2 exists, check whether the feature branch already exists.

If the local feature branch exists:

git switch feature/v4.2d-discovery-experience

If only the remote feature branch exists:

git switch --track origin/feature/v4.2d-discovery-experience

If neither exists:

git switch -c feature/v4.2d-discovery-experience origin/integration/v4.2

After switching, run:

git branch --show-current
git status
git merge-base --is-ancestor origin/integration/v4.2 HEAD
git log --oneline --decorate -5

The first command must return exactly:

feature/v4.2d-discovery-experience

The merge-base command must succeed.

If either condition fails:

STOP IMMEDIATELY.

Do not modify any file.

Before implementation, explicitly report:

ACTIVE BRANCH: feature/v4.2d-discovery-experience
BASE BRANCH: origin/integration/v4.2
WORKING TREE: clean or explain existing changes
BRANCH GATE: PASSED

Only after reporting BRANCH GATE: PASSED may implementation begin.

==================================================
READ FIRST
==================================================

Read:

docs/prompts/MASTER-00.md

Also inspect the approved Team 2 Goal Taxonomy API contract if it already exists in the integration branch.

Do not assume Team 2 implementation is available.

Do not cherry-pick Team 2 yourself.
Do not merge Team 2 yourself.
Do not modify Team 2 files.
Do not copy Team 2 business logic into the frontend.

If the required Goal Taxonomy contract is not present in the base branch, use a typed frontend adapter and development fixture isolated behind that adapter.

Clearly report the dependency as:

WAITING FOR TEAM-02 INTEGRATION

The UI must be designed so the adapter can be connected to the real API later without rewriting components.

==================================================
PROJECT
==================================================

Creative AI Platform

Phase:

V4.2D — Goal-Based Discovery Experience

and the frontend-only portion of:

V4.2G — Marketplace Discovery UX

==================================================
TEAM RESPONSIBILITY
==================================================

Team 3 is responsible only for the customer-facing discovery experience.

Responsible scope:

- Goal-based customer discovery interface
- Goal browsing experience
- Goal detail experience
- Service discovery navigation
- Customer-friendly search experience
- Goal cards and goal collections
- Goal-to-service presentation
- Loading states
- Empty states
- Error states
- Responsive behavior
- Accessibility
- Frontend API adapter
- Frontend components
- Frontend tests
- Customer marketplace UX improvements directly related to goal discovery

Not responsible for:

- Goal Taxonomy database
- Goal repository
- Backend Goal API implementation
- Commercial eligibility policy
- Recommendation ranking engine
- AI recommendation engine
- AI chat assistant
- Service normalization
- Service deduplication
- Pricing changes
- Checkout changes
- Order workflow
- Analytics backend
- SEO backend
- Creative workflow runtime
- Presentation engine
- AI workers
- Database migration
- Seed scripts
- Admin management UI
- BizPortal redesign

==================================================
PRIMARY MISSION
==================================================

Transform customer service discovery from a long list of services into a simple goal-based journey.

Current customer experience:

Customer
→ sees many categories
→ sees many services
→ must understand which service is suitable
→ becomes confused

Target customer experience:

Customer
→ chooses a business goal
→ understands what the goal achieves
→ sees relevant eligible services
→ can inspect a service
→ can continue using the existing quotation or request flow

Examples of customer goals:

- Launch My Brand
- Improve My Brand Identity
- Promote My Business
- Create Marketing Content
- Prepare a Business Presentation
- Improve Product Packaging
- Build a Social Media Presence
- Design My Business Materials

These examples are illustrative only.

Do not hardcode the final taxonomy if the Goal API supplies it.

==================================================
CORE ARCHITECTURE
==================================================

The frontend must use this conceptual flow:

Customer Interface
        ↓
Goal Discovery Components
        ↓
Goal API Adapter
        ↓
Goal Taxonomy API
        ↓
Commercially Eligible Services

Frontend components must not independently decide commercial eligibility.

Commercial eligibility is a backend responsibility.

The frontend must only display services returned by the approved public API.

Do not recreate logic such as:

visibility === "public"

or:

commercial_status === "commercial_ready"

inside React components.

==================================================
DEPENDENCY CONTRACT
==================================================

Expected public API contract from Team 2 may include:

GET /api/ai/goals

GET /api/ai/goals/:slug

GET /api/ai/goals/:slug/services

Before using these endpoints:

1. Inspect the actual contract present in the branch.
2. Reuse actual response fields.
3. Do not invent response fields inside production code.
4. Create typed normalization at the adapter boundary if needed.
5. Handle missing optional fields safely.

The UI must not call admin endpoints.

Forbidden endpoints include:

POST /api/ai/goals

PATCH /api/ai/goals/:slug

POST /api/ai/goals/:slug/services

POST /api/ai/goals/:slug/services/bulk

DELETE /api/ai/goals/:slug/services/:serviceId

Customer-facing pages may use public GET endpoints only.

==================================================
REQUIRED AUDIT BEFORE CODING
==================================================

Before editing files, inspect and document:

1. Existing customer marketplace routes
2. Existing catalog page
3. Existing service cards
4. Existing service detail routes
5. Existing search implementation
6. Existing category filters
7. Existing API client conventions
8. Existing loading skeletons
9. Existing error boundary patterns
10. Existing responsive navigation
11. Existing accessibility utilities
12. Existing test framework
13. Existing design system components
14. Existing commercial catalog endpoint usage

Produce a short audit table:

Area
Existing file
Current behavior
Reuse plan
Risk

Do not create duplicate components when suitable reusable components already exist.

==================================================
IMPLEMENTATION REQUIREMENTS
==================================================

Implement the following customer experience.

--------------------------------------------------
1. GOAL DISCOVERY ENTRY SECTION
--------------------------------------------------

Add a clear discovery entry point to the customer marketplace.

Customer-facing language must focus on outcomes, not internal AI architecture.

Recommended heading style:

What do you want to create?

or:

What business goal would you like to achieve?

Do not use technical terms such as:

taxonomy
mapping
repository
commercial status
service registry
agent orchestration

The section must:

- Load goals from the public Goal API adapter
- Show only active goals returned by the API
- Support loading state
- Support empty state
- Support error state
- Be keyboard accessible
- Work on mobile and desktop
- Preserve existing marketplace navigation

Do not remove the existing service catalog unless explicitly required by the existing approved design.

Goal discovery should be additive and backward compatible.

--------------------------------------------------
2. GOAL CARD COMPONENT
--------------------------------------------------

Create a reusable goal card.

A goal card may display fields that exist in the API contract, such as:

- Name
- Short description
- Icon reference
- Image reference
- Service count
- Display order

Do not invent fake statistics.

Do not display fake values such as:

- 98% success rate
- 500+ clients
- AI confidence
- Most popular
- Recommended
- Trending

unless those values come from a real approved source.

Each card must support:

- Mouse interaction
- Keyboard interaction
- Visible focus state
- Semantic link or button behavior
- Mobile touch target
- Reduced-motion preference

--------------------------------------------------
3. GOAL DETAIL EXPERIENCE
--------------------------------------------------

Create or integrate a customer-facing route for goal details.

Preferred route pattern:

/goals/:slug

Use the project’s existing routing conventions.

The goal detail page should include:

- Goal name
- Goal description
- Relevant services
- Clear explanation of what the customer can achieve
- Existing service cards or a compatible reusable variant
- Existing service detail links
- Existing quotation/request CTA behavior
- Loading state
- Empty service state
- Invalid goal state
- Network error state

Do not create a new order flow.

Do not create a new checkout flow.

Continue to use the existing service detail and request flow.

--------------------------------------------------
4. GOAL-TO-SERVICE PRESENTATION
--------------------------------------------------

Services shown under a goal must come from:

GET /api/ai/goals/:slug/services

or the approved equivalent found in the codebase.

Do not fetch all services and map them to goals in the browser.

Do not hardcode service IDs.

Do not hardcode database IDs.

Do not duplicate goal mappings in frontend constants.

Reuse existing service card components where possible.

If an adapter is required, isolate it in a clearly named module.

Example conceptual structure:

goalDiscoveryApi.ts
goalDiscoveryTypes.ts
useGoals.ts
useGoalDetail.ts

Follow existing project conventions rather than forcing these exact filenames.

--------------------------------------------------
5. SEARCH AND FILTER INTEGRATION
--------------------------------------------------

Improve discovery without replacing the existing search system unnecessarily.

Goal discovery and service search must coexist.

Expected behavior:

- Customer can browse by goal
- Customer can still search for a known service
- Existing category filters remain functional
- Selecting a goal should not silently corrupt other filters
- Back/forward browser navigation should remain correct
- URL state should be used where consistent with the existing app

Do not create a recommendation engine.

Search remains deterministic.

Do not use AI calls for search.

--------------------------------------------------
6. CUSTOMER-FRIENDLY COPY
--------------------------------------------------

Replace confusing technical wording only within Team 3 scope.

Use simple language.

Examples:

Avoid:

Select service taxonomy

Use:

Choose what you want to achieve

Avoid:

Mapped service entities

Use:

Services that can help

Avoid:

Commercially eligible services

Use:

Available services

Do not rewrite unrelated pages.

--------------------------------------------------
7. LOADING, EMPTY, AND ERROR STATES
--------------------------------------------------

Implement honest states.

Loading:

- Use existing skeleton components
- Avoid layout shift
- Do not show fake goal cards as real content

Empty goals:

Suggested meaning:

No goals are available yet. You can still browse all services.

Empty goal services:

Suggested meaning:

No services are currently available for this goal.

Error:

- Provide retry where appropriate
- Do not expose stack traces
- Do not expose internal endpoint details
- Do not expose database errors
- Preserve access to the regular catalog

--------------------------------------------------
8. RESPONSIVE DESIGN
--------------------------------------------------

Verify at minimum:

- Mobile width approximately 360 px
- Tablet width approximately 768 px
- Desktop width approximately 1280 px

Requirements:

- No horizontal overflow
- Cards remain readable
- Touch targets remain usable
- Titles do not overlap
- Search remains usable
- Filters remain understandable
- Goal detail CTA remains visible
- Existing navigation remains stable

--------------------------------------------------
9. ACCESSIBILITY
--------------------------------------------------

Required:

- Semantic headings
- Correct heading order
- Keyboard navigation
- Visible focus
- Accessible link/button names
- ARIA only where necessary
- Screen-reader-friendly loading text
- Error announcements where appropriate
- Reduced-motion support
- Sufficient contrast using existing design tokens

Do not use clickable div elements without keyboard semantics.

--------------------------------------------------
10. PERFORMANCE
--------------------------------------------------

Requirements:

- Avoid duplicate API requests
- Avoid fetching all goal details on initial load
- Fetch detail data when needed
- Reuse existing query/cache mechanism
- Avoid unnecessary rerenders
- Lazy-load noncritical screens when consistent with current architecture
- Avoid adding a large dependency for functionality already available
- Do not add another state-management framework

==================================================
PUBLIC ROUTING REQUIREMENTS
==================================================

Use existing customer portal routing conventions.

Do not break:

- Existing marketplace route
- Existing service detail route
- Existing quotation route
- Existing request route
- Existing checkout flow
- Existing deep links

Legacy customer bookmarks must continue working.

Goal routes are additive.

==================================================
TYPING REQUIREMENTS
==================================================

Do not use untyped API responses.

Create or reuse typed contracts.

Avoid:

any
unknown casts without validation
duplicate interface definitions
database row types inside UI components

Normalize API data at the frontend boundary.

Components must consume customer-facing view models, not raw database objects where avoidable.

==================================================
SECURITY REQUIREMENTS
==================================================

Customer frontend must never expose:

- Internal commercial status
- Internal visibility controls
- Admin-only fields
- Database IDs unless already part of approved public contract
- Internal notes
- Cost records
- Provider metadata
- AI prompts
- AI runtime logs
- Stack traces
- Admin authentication details

Do not add or expose admin API keys.

Do not put secrets in frontend environment variables.

Do not bypass backend authorization.

==================================================
DATA HONESTY
==================================================

Do not add fake:

- Testimonials
- Ratings
- Review counts
- Popularity labels
- Customer counts
- Completion percentages
- Confidence scores
- Delivery promises
- Pricing discounts
- Performance claims

Only display values backed by approved data.

==================================================
ALLOWED FILES
==================================================

Team 3 may modify customer-facing frontend files related to:

- Marketplace discovery
- Goal discovery
- Goal detail pages
- Customer routing
- Customer API adapter
- Reusable customer components
- Customer frontend tests
- Team 3 documentation

Use the actual repository paths discovered during audit.

==================================================
FORBIDDEN FILES
==================================================

Do not modify:

- Database schema
- SQL migrations
- Backend Goal repository
- Backend Goal service
- Backend Goal routes
- Commercial eligibility policy
- Pricing service
- Order service
- Payment service
- Creative workflow runner
- AI runtime
- Presentation engine
- Recommendation engine
- Analytics backend
- Admin Goal API
- BizPortal pages
- Team 1 files
- Team 2 files
- Team 4 files
- Team 5 files
- GitHub workflows
- Replit configuration
- Production environment variables

Exception:

A shared frontend type or API export may be changed only when strictly required and when it does not modify another team’s business logic.

Document every such exception.

==================================================
DO NOT
==================================================

Do not:

- Add database tables
- Apply migrations
- Seed production data
- Change service eligibility rules
- Create AI recommendation logic
- Add chatbot functionality
- Add bundles
- Change pricing
- Change checkout
- Change order creation
- Rename service codes
- Rename goal slugs supplied by API
- Rename public endpoints
- Replace existing design system
- Perform broad refactoring
- Fix unrelated bugs
- Merge branches
- Push main
- Force-push main

==================================================
TESTING REQUIREMENTS
==================================================

Add or update tests for:

1. Goal list loading
2. Goal list success
3. Goal list empty state
4. Goal list error state
5. Goal card keyboard accessibility
6. Goal navigation
7. Goal detail loading
8. Goal detail success
9. Invalid goal
10. Goal with no services
11. Goal service rendering
12. Existing service detail link
13. Retry behavior
14. Responsive-safe rendering where supported
15. API response normalization
16. No admin endpoint usage
17. Existing marketplace regression

Use the repository’s existing test framework.

Do not introduce a new test framework.

==================================================
MANUAL VERIFICATION
==================================================

Verify:

- Marketplace still opens
- Existing service browsing still works
- Goal cards load
- Goal detail opens
- Relevant services render
- Existing service detail opens
- Existing quote/request CTA remains functional
- Empty goals state works
- Empty services state works
- Error state works
- Browser back button works
- Mobile layout works
- Desktop layout works
- Keyboard navigation works
- Focus state is visible
- No admin data appears
- No fake customer metrics appear

Screenshots may be used only for frontend verification.

Do not commit unrelated screenshots unless the repository has an approved screenshot-test convention.

==================================================
TYPECHECK AND BUILD
==================================================

Run the actual repository commands for:

- Relevant frontend tests
- Customer portal typecheck
- Shared frontend library typecheck, if affected
- Customer portal production build

If the full monorepo has pre-existing failures:

- Capture the exact baseline
- Prove no new Team 3 error was introduced
- Do not claim the full suite passed when it did not

==================================================
COMMIT RULES
==================================================

Before every commit, run:

git branch --show-current

The result must be exactly:

feature/v4.2d-discovery-experience

If not:

STOP.

Do not commit.

Use focused commits.

Suggested commit structure:

feat(discovery): add goal-based marketplace entry
feat(discovery): add goal detail customer experience
test(discovery): cover goal discovery states
docs(team-03): add implementation report

Do not include unrelated files.

Before push, run:

git diff --name-status origin/integration/v4.2..HEAD
git log --oneline origin/integration/v4.2..HEAD

Review every file and commit.

==================================================
PUSH RULES
==================================================

Push only:

feature/v4.2d-discovery-experience

Command:

git push -u origin feature/v4.2d-discovery-experience

Do not push main.

Do not merge into main.

Do not merge into integration/v4.2.

Do not create a merge commit from another team branch.

Team 6 will review and integrate the work.

==================================================
FINAL BRANCH VERIFICATION
==================================================

After push, run:

git branch --show-current
git status
git branch -vv
git log --oneline --decorate -10
git diff --name-status origin/integration/v4.2..HEAD

Required final state:

- Active branch is feature/v4.2d-discovery-experience
- Working tree is clean
- Branch tracks origin/feature/v4.2d-discovery-experience
- Team 3 commits exist remotely
- No Team 3 commit exists only on local main
- No unrelated file appears in the diff

==================================================
FINAL REPORT
==================================================

Return the report using this exact structure:

# TEAM-03 FINAL REPORT

## 1. Branch Verification

Active branch:

Base branch:

Remote tracking branch:

Branch gate result:

Confirm:

- Work was not performed on main
- Main was not pushed
- Integration branch was not directly modified

## 2. Executive Summary

Describe the customer-facing experience implemented.

## 3. Existing Architecture Audit

List:

- Reused pages
- Reused components
- Reused API client
- Reused routing
- Reused design system

## 4. Scope Completed

List completed Team 3 requirements.

## 5. Files Changed

For every file:

Path
Change
Reason

## 6. API Integration

List public GET endpoints used.

Confirm no admin endpoint is called.

## 7. Dependency Status

State whether Team 2 Goal API was present in the base branch.

If not present, explain the adapter or fixture used.

## 8. Routes

List added or modified frontend routes.

Confirm existing routes remain valid.

## 9. Tests

Provide exact commands and results.

Do not summarize without command output.

## 10. Typecheck

Provide exact command and result.

## 11. Production Build

Provide exact command and result.

## 12. Manual Verification

Report:

- Mobile
- Tablet
- Desktop
- Keyboard
- Loading
- Empty
- Error
- Goal detail
- Existing service navigation

## 13. Accessibility Review

Report verified accessibility behavior.

## 14. Security Review

Confirm:

- No secret exposed
- No admin endpoint used
- No internal metadata exposed
- No eligibility logic duplicated in frontend

## 15. Backward Compatibility

Confirm:

- Existing catalog remains available
- Existing service links work
- Existing quote/request flow remains unchanged
- Legacy URLs remain valid

## 16. Known Limitations

Be explicit.

## 17. Remaining Risks

List actual risks.

## 18. Commit List

Show:

git log --oneline origin/integration/v4.2..HEAD

## 19. Final Diff

Show:

git diff --name-status origin/integration/v4.2..HEAD

## 20. Push Confirmation

Confirm remote branch:

origin/feature/v4.2d-discovery-experience

==================================================
STOP CONDITION
==================================================

After completing and pushing Team 3 work:

STOP.

Do not implement:

- Recommendation Engine
- AI Discovery Chat
- Solution Bundles
- Service Normalization
- Analytics
- SEO
- Admin Goal Management
- Team 4 scope
- Team 5 scope
- Team 6 scope

Do not merge the branch.

Wait for Team 6 review.