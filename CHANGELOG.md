# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
