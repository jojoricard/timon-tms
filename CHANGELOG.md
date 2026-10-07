# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- SPEC-001 resources, accepted: drivers, power units and trailers, capabilities, expiring documents, CSV import; mockups of the four screens (`docs/design/mockups/`)
- Resources (SPEC-001, #5): drivers, power units and trailers with their characteristics, capabilities and compliance documents; status of each document and resource on today's date, in Europe/Paris, with a warning period per document type; archiving and restoring, never deleting
- Expiries screen: every document expired or within its warning period, expired first, then by date
- CSV import of drivers, power units or trailers, in English or French, all or nothing, with a preview of every error by line; up to 1 MB and 2,000 lines
- Company lists seeded by migration: document types, body types, trade labels, capabilities
- Demo data: the fleet of the mockups (18 drivers, 12 power units, 15 trailers), its deadlines moved to today's date
- IBM Plex Sans and Mono, served with the application

### Changed

- Resources is the home screen; the booking screen of the skeleton is gone (the booking API and its exclusion constraint stay)
- Existing local and demo resources are cleared by migration 0002; `pnpm db:seed` writes the new demo haulier

### Security

- esbuild pulled by drizzle-kit (through `@esbuild-kit/core-utils`) raised from 0.18.20 to 0.25 with a pnpm override, fixing GHSA-67mh-4wv8-2f99; no copy below 0.25 remains

## [0.3.0] - 2026-10-06

### Added

- Code skeleton: pnpm monorepo with the eight packages of ADR-002, TypeScript, Biome, Vitest
- First vertical slice: book a resource over a period; PostgreSQL refuses an overlap with an exclusion constraint, the API answers 409 with the conflicting bookings, the interface warns before sending with the same rule
- The same slice on Node with PostgreSQL 18 and in the browser, with the API in a service worker on PGlite
- Interface in French and English from the first screen (Paraglide JS); CSS variables generated from the design tokens
- Local environment: `compose.yaml` (PostgreSQL 18), `.nvmrc`, `.env.example`, demo data generator
- CI workflow: lint, type checks, tests on PGlite and on PostgreSQL 18, dependency direction, message completeness, migrations in sync with the schema, Playwright smoke test on the demo build
- Vercel configuration for the demo and pull request previews; Dependabot for npm and GitHub Actions

### Changed

- ADR-002 1.1: the web app may import types from `http` and the demo may depend on `web`; TypeScript 7 and packages shipped as TypeScript sources run by Node 24

## [0.2.0] - 2026-10-05

### Added

- ADR-002: target architecture (pnpm monorepo, React, Hono, Drizzle, in-browser demo on PGlite)
- ADR-003: environments and hosting (local PostgreSQL in Docker, demo and pull request previews on Vercel, GitHub flow)

### Changed

- ADR-001 1.1: sharing rules in C#, Python or Go is possible through WebAssembly; the comparison now says so
- Scoping note 0.8: architecture and environments decisions, production hosting left open until authentication

### Fixed

- Word export: a decision box no longer drags the following content onto the next page

## [0.1.0] - 2026-10-05

### Added

- Project scoping note (`docs/scoping.md`)
- ADR-001: TypeScript and PostgreSQL
- Word export of the documents with the Agence JRi template (`docs/export/`)
- Docs workflow: Word and PDF built on every change, attached to releases (`.github/workflows/docs.yml`)
- Visual identity: logo, brand guidelines (PDF), design tokens and six mockups in English (`docs/design/`)

### Changed

- Scoping note 0.7: order shape (one pickup or one delivery per order), requirements and capabilities, non-order activities, French and English interface from the start, open question on maps and truck routing
