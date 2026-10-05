# Timon

[![Docs](https://github.com/jojoricard/timon-tms/actions/workflows/docs.yml/badge.svg)](https://github.com/jojoricard/timon-tms/actions/workflows/docs.yml)

**An open-source transport management system for road hauliers, built around resource planning.**

Timon helps a dispatcher plan drivers, tractors, rigid trucks and trailers, assign orders in one gesture and see conflicts before they happen: a resource booked twice, an expired licence, the wrong trailer for the load.

> In French, a *timon* is the drawbar that ties a team to its wagon, and a *timonier* holds the helm. Timon holds resources together and helps the dispatcher keep the day on course.

![Timon planning mockup: order well on the left, resources grouped by family, an order being dragged onto a compatible unit.](docs/design/mockups/planning.png)

## Status

**Scoping and visual identity done, foundations in progress.** No code yet: the project is run end to end, from scoping to delivery, and every decision is recorded in [`docs/`](docs/).

| Phase | Content | Status |
| --- | --- | --- |
| 0. Scoping | Vision, target, market, regulation, domain model, roadmap | Done |
| 1. Foundations | Visual identity and design system (done), target architecture, CI | In progress |
| 2. Planning release | Reference data, units, orders, planning and conflicts, emissions report | Planned |
| 3–5 | Extended operations, driver app, customer portal | Later |

## Documentation

| Document | Source | PDF |
| --- | --- | --- |
| Project scoping: vision, target, market, regulation, domain model, scope, roadmap, decisions | [scoping.md](docs/scoping.md) | [PDF](https://github.com/jojoricard/timon-tms/releases/latest/download/TIMON-CAD-001-scoping.pdf) |
| ADR-001: TypeScript and PostgreSQL | [0001-typescript-postgresql.md](docs/adr/0001-typescript-postgresql.md) | [PDF](https://github.com/jojoricard/timon-tms/releases/latest/download/TIMON-ADR-001-language-and-database.pdf) |
| Brand guidelines: logo, colour, type, signature elements, screens, voice | [guidelines/](docs/design/guidelines/index.html) | [PDF](docs/design/timon-brand-guidelines.pdf) |
| Visual identity and mockups | [design/README.md](docs/design/README.md) | |

The Markdown files are the sources. A GitHub Actions workflow builds the Word and PDF versions on every change and attaches them to each release; locally, `sh docs/export/build-docs.sh` produces the Word files (requires [pandoc](https://pandoc.org/)).

## Tech stack

TypeScript across the interface, the API and a shared `domain` package; PostgreSQL. See [ADR-001](docs/adr/0001-typescript-postgresql.md).

## How the project is run

One scoping phase, then a Kanban flow: each feature gets a short spec, a mockup, an ADR when needed, tests derived from its acceptance criteria and a demo. Work is tracked on the project's public GitHub Projects board.

## License

[GNU AGPL-3.0](LICENSE). You can use, modify and self-host Timon; if you offer it as a service, you must publish your changes.

---

Designed and built by Joris Ricard · Agence JRi
