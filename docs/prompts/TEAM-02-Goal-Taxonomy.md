# TEAM-02

# GOAL TAXONOMY FOUNDATION

Version:
1.0

Status:
ACTIVE

Branch:

feature/v4.2c-goal-taxonomy

---

# MANDATORY BRANCH CHECK

Before doing ANYTHING:

1. Check current branch.

2. If current branch is:

main

STOP.

Do not modify any file.

3. Checkout:

integration/v4.2

4. Create (or switch to):

feature/v4.2c-goal-taxonomy

5. Report:

Current branch

Current commit

Base branch

Do not continue until the correct branch is active.

---

# READ FIRST

Read:

MASTER-00.md

before implementing anything.

All MASTER rules apply.

---

# PROJECT

Creative AI Platform

Phase

V4.2C

Goal Taxonomy Foundation

---

# TEAM RESPONSIBILITY

Responsible for:

✓ Goal Taxonomy

✓ Goal Registry

✓ Goal Slug

✓ Goal Metadata

✓ Goal Hierarchy

✓ Goal Repository

✓ Goal API

✓ Backend Tests

Not responsible for:

✗ UI

✗ Marketplace

✗ Recommendation Engine

✗ Analytics

✗ SEO

✗ Runtime

✗ Creative Workflow

✗ Presentation Engine

✗ Commercial Policy

---

# PRIMARY OBJECTIVE

The platform currently exposes services.

We want customers to browse by GOAL.

Examples:

Current

Logo Design

Brand Guideline

Packaging

Social Media Design

Business Card

Pitch Deck

Presentation

Website UI

New

I want to launch my brand

↓

Customer sees ONE Goal

↓

System recommends

Logo

Brand Guideline

Packaging

Social Media Kit

Business Card

Automatically.

---

# IMPORTANT

DO NOT change

existing service

existing pricing

existing order

existing workflow

existing runtime

existing category

This phase only introduces

Goal Taxonomy

as a NEW abstraction layer.

---

# ARCHITECTURE

Current

Customer

↓

Category

↓

Service

Target

Customer

↓

Goal

↓

Category

↓

Service

Goal must NEVER replace category.

Goal is an additional layer.

---

# DESIGN PRINCIPLES

Goal Taxonomy must be:

Pure

Typed

Reusable

Extensible

Deterministic

Database-driven

No hardcoded UI logic.

---

# ALLOWED FILES

You MAY modify:

api-server

goal service

repository

types

validation

backend tests

shared contracts

documentation

---

# FORBIDDEN FILES

Do NOT modify:

customer-portal

bizportal

CSS

React Components

Marketplace UI

Recommendation Engine

Commercial Policy

Analytics

SEO

Runtime

Dispatcher

Presentation

Creative Workflow

AI Provider

---

# STOP CONDITION

Do NOT continue into Recommendation Engine.

Do NOT implement AI Discovery.

Do NOT create bundles.

Stop after Goal Taxonomy Foundation is complete.
