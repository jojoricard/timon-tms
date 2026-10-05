# Timon

**An open-source transport management system for road hauliers, built around resource planning.**

Timon helps a dispatcher plan drivers, tractors, rigid trucks and trailers, assign orders in one gesture and see conflicts before they happen: a resource booked twice, an expired licence, the wrong trailer for the load.

> In French, a *timon* is the drawbar that ties a team to its wagon, and a *timonier* holds the helm. Timon holds resources together and helps the dispatcher keep the day on course.

## Status

**Scoping done, foundations in progress.** No code yet: the project is run end to end, from scoping to delivery, and every decision is recorded in [`docs/`](docs/).

| Phase | Content | Status |
| --- | --- | --- |
| 0. Scoping | Vision, target, market, regulation, domain model, roadmap | Done |
| 1. Foundations | Visual identity, design system, target architecture, CI | In progress |
| 2. Planning release | Reference data, units, orders, planning and conflicts, emissions report | Planned |
| 3–5 | Extended operations, driver app, customer portal | Later |

## Documentation

- [Project scoping](docs/scoping.md): vision, target user, market, regulation, domain model, scope, roadmap, decisions, glossary
- [Architecture decision records](docs/adr/)
  - [ADR-001: TypeScript and PostgreSQL](docs/adr/0001-typescript-postgresql.md)

Word versions of the documents are generated from the Markdown sources with `sh docs/export/build-docs.sh` (requires [pandoc](https://pandoc.org/)).

## Tech stack

TypeScript across the interface, the API and a shared `domain` package; PostgreSQL. See [ADR-001](docs/adr/0001-typescript-postgresql.md).

## How the project is run

One scoping phase, then a Kanban flow: each feature gets a short spec, a mockup, an ADR when needed, tests derived from its acceptance criteria and a demo. Work is tracked on the project's public GitHub Projects board.

## License

[GNU AGPL-3.0](LICENSE). You can use, modify and self-host Timon; if you offer it as a service, you must publish your changes.

---

Designed and built by Joris Ricard · Agence JRi
