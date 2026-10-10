# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-10-10

### Added

- SPEC-001 resources, accepted: drivers, power units and trailers, capabilities, expiring documents, CSV import; mockups of the four screens (`docs/design/mockups/`)
- Resources (SPEC-001, #5): drivers, power units and trailers with their characteristics, capabilities and compliance documents; status of each document and resource on today's date, in Europe/Paris, with a warning period per document type; archiving and restoring, never deleting
- Expiries screen: every document expired or within its warning period, expired first, then by date
- CSV import of drivers, power units or trailers, in English or French, all or nothing, with a preview of every error by line; up to 1 MB and 2,000 lines
- Company lists seeded by migration: document types, body types, trade labels, capabilities
- Demo data: the fleet of the mockups (18 drivers, 12 power units, 15 trailers), its deadlines moved to today's date
- IBM Plex Sans and Mono, served with the application
- SPEC-002 customers and sites, accepted (1.1), with the mockups of the six screens (`docs/design/mockups/`)
- Customers (SPEC-002, #6): legal identity, SIRET checked (Luhn, La Poste rule) and unique among active customers, VAT number proposed from the SIREN, code unique with archived customers, billing address, contacts deleted for good when removed, usual sites
- Sites, one address book for the company: address located by the IGN national address base, or by hand on a map (Leaflet, OpenStreetMap tiles), and how it was located; time zone from the country; opening hours per day, with nights over two days; booking, protective equipment, access limits, gate phone and instructions; a warning for an active site within 50 m or on the same street
- Geocoding behind a port of the application, in a new `packages/geocoding` with the IGN adapter and a rate limiter under the service's 50 requests per second; a failed lookup saves the site as not located, so the demo works offline
- CSV import of customers and of sites, all or nothing; French sites without coordinates are located during the preview, and a site that cannot be located is imported as not located
- Protective equipment: a company list, required by sites, held by drivers (driver form and list)
- Demo data: the customers and sites of the SPEC-002 mockups
- ADR-004 maps and geocoding: why the IGN address base, Leaflet and OpenStreetMap tiles, their terms of use and the way out

### Changed

- Resources is the home screen; the booking screen of the skeleton is gone (the booking API and its exclusion constraint stay)
- Existing local and demo resources are cleared by migration 0002; `pnpm db:seed` writes the new demo haulier
- ADR-002 1.2: `packages/geocoding` joins the packages; geocoding and the site map are recorded; truck routing and distances stay out of scope
- ADR-002 1.3: points to ADR-004 for the alternatives and terms of use of geocoding and the map
- The import screen is shared by resources, customers and sites
- Lists open a record from anywhere on its row; the "Open" columns are gone, and the name in each row stays a link for the keyboard
- Lists lay out their columns from fixed widths: columns stay in place across the resource tabs and while filtering, every row has the same height, and long French column titles take a second line
- Forms: panels side by side line up (site form as two rows of two), contact Remove buttons sit level with the fields, document actions are centred in their row, and the file field of the imports reads as a drop zone

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
