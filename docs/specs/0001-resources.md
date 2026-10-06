---
title: "Resources"
subtitle: "Functional specification"
reference: TIMON-SPEC-001
version: "0.2"
date: "October 6, 2026"
status: "Draft"
---

# TIMON-SPEC-001 — Resources

Issue [#5](https://github.com/jojoricard/timon-tms/issues/5). Drivers, power units and trailers, what they can do and the documents that allow them to work.

## Context

Everything in the planning rests on resources: a unit is made of them, an order is checked against them. Today a haulier keeps them in a spreadsheet, with expiry dates in another column nobody watches until a roadside check. This feature replaces that spreadsheet: the dispatcher records each resource once, Timon computes what is valid on a given date and warns before anything lapses.

The planning itself, units and orders come in later features. This one provides the data and the rules they will read.

## User stories

- As a dispatcher, I record a driver, a power unit or a trailer with its characteristics, so that the planning knows what it can do.
- As a dispatcher, I record each compliance document with its expiry date, so that Timon can tell whether the resource may work on a given day.
- As a dispatcher, I see in one list every document that has expired or is about to, so that renewals are booked in time.
- As a fleet manager taking over an existing fleet, I import my resources from a CSV file, so that I do not type forty records by hand.
- As a dispatcher, I archive a resource that has left the company, so that it disappears from the planning without losing its history.

<!-- pagebreak -->

## What a resource holds

| | Driver | Power unit | Trailer |
| --- | --- | --- | --- |
| Identity | Last name, first name, display name (e.g. "K. Benali"), employee number (optional), phone | Registration plate | Registration plate |
| Kind | — | Tractor, rigid truck or light van | Semi-trailer or drawbar trailer |
| Regulatory category | — | N1, N2 or N3 | O1, O2, O3 or O4 |
| Weights | — | Gross vehicle weight; gross combination weight if it can pull | Gross vehicle weight |
| Trade label | — | From the company's list (e.g. "PL", "PP", "GP"), optional | From the company's list, optional |
| Body type | — | Rigid truck and light van only: curtainsider, box, refrigerated, flatbed, tipper, tanker… | Same list |
| Capabilities | — | Tail lift, crane, side loading, temperature control | Same list |
| Documents | See below | See below | See below |

A tractor has no body type: it carries nothing without a semi-trailer. Body types, trade labels and capabilities are company lists, seeded with the values above and editable later.

## Documents

A document has a type, an optional reference, an issue date (optional) and an **expiry date**. Each type says what it applies to, whether it is **blocking**, and how early it **warns**: an expired blocking document makes the resource unavailable for any assignment that needs it; a non-blocking one only raises a warning. The warning period matches the time a renewal really takes: a CPC refresher course or an ADR course is booked months ahead, a roadworthiness test a few weeks.

| Held by | Document type | Blocking | Warns | Needed for |
| --- | --- | --- | --- | --- |
| Driver | Driving licence, per category (B, C1, C, CE, C1E) | Yes | 60 days | Driving a vehicle of that category |
| Driver | CPC (FIMO, then FCO every five years) | Yes | 90 days | Driving an N2 or N3 vehicle |
| Driver | Driver card (tachograph) | Yes | 30 days | Driving a vehicle with a tachograph |
| Driver | ADR certificate | Yes | 90 days | Orders with an ADR class |
| Driver | Occupational health check | No | 30 days | — |
| Power unit, trailer | Roadworthiness test | Yes | 30 days | Any assignment |
| Power unit | Tachograph inspection | Yes | 30 days | Any assignment |
| Power unit, trailer | ATP certificate | Yes | 60 days | Temperature-controlled orders |
| Power unit, trailer | ADR approval | Yes | 30 days | Orders with an ADR class |

The type list is a company list: a haulier can add its own non-blocking types (insurance, site induction) and adjust warning periods; new types warn 30 days ahead. For a heavy licence, the expiry date also reflects the medical check required to renew it; Timon stores the date only, never medical information.

**Status of a document on a date.** *Valid*, *expiring* (expires within the warning period of its type), *expired* (the expiry date is before the date), or *missing* (needed but not recorded; this case appears with units and orders). The status of a resource on a date is the worst status among its documents.

## Business rules

1. A registration plate is unique among active resources. It is compared without spaces, dashes or case: "ab-123-cd" and "AB 123 CD" are the same plate. Foreign plates are accepted as typed.
2. The kind and the category must agree: a light van is N1; a rigid truck is N2 or N3; a tractor is N2 or N3; a semi-trailer is O3 or O4.
3. Weights are in kilograms and positive; the gross combination weight, when given, is greater than the gross vehicle weight.
4. A document expires at the end of its expiry day, in the company's time zone (Europe/Paris).
5. A resource is never deleted once it exists: it is archived. Archived resources are hidden from lists and the planning by default and can be restored.
6. A CSV import is all or nothing: if one line is invalid, nothing is imported and every error is listed with its line number.
7. Every resource belongs to a subsidiary of the company. Until subsidiaries have their own screens (issue #14), it is the company's single subsidiary and the interface does not show it; the data is ready for a group with several.

## Screens

- **Resources**: one tab per kind, a searchable table (name or plate, kind, category, body type, next expiry with its status colour), a filter "expired or expiring", a button to add, a button to import.
- **Resource form**: identity and characteristics, then the documents as a list of rows (type, reference, expiry date, status). Created and edited in the same form.
- **Expiries**: every document expired or within its warning period, all resources together, sorted by date; a click opens the resource.
- **Import**: download a CSV template per kind, upload a file, preview the rows with their errors, confirm.

The screens follow the design system: status colours from the tokens (ok, warning, conflict), monospaced figures for plates and dates, French and English from the first screen.

## Acceptance criteria

1. **Given** a driver with a CE licence expiring on 2026-11-20, **when** I look at the driver on 2026-10-25, **then** the licence is *expiring* and the driver's status is *expiring*.
2. **Given** the same driver, **when** I look on 2026-11-21, **then** the licence is *expired* and the driver's status is *expired*.
3. **Given** a document expiring on 2026-11-20, **when** I look on 2026-11-20 at 23:30 Paris time, **then** it is *expiring*, not *expired*.
4. **Given** an occupational health check that expired yesterday, **when** I look at the driver, **then** it is shown as expired with the warning colour, and it does not count as blocking.
5. **Given** an active power unit with plate "AB-123-CD", **when** I create another with "ab 123 cd", **then** the form refuses it and names the existing resource.
6. **Given** a light van, **when** I choose category N3, **then** the form refuses it and explains the allowed categories.
7. **Given** a tractor, **when** I open its form, **then** no body type can be chosen.
8. **Given** roadworthiness tests (30-day warning) expiring in 5, 20 and 45 days and one expired 3 days ago, **when** I open Expiries, **then** I see three rows: the expired one first, then the ones expiring in 5 and 20 days.
9. **Given** a CSV of 40 drivers where line 17 has no last name, **when** I upload it, **then** nothing is imported and the preview shows "line 17: last name is required".
10. **Given** a valid CSV of 40 trailers, **when** I confirm the import, **then** 40 trailers exist and the list shows them.
11. **Given** an archived driver, **when** I open the driver list, **then** the driver is not shown; **when** I tick "show archived", **then** the driver appears and can be restored.
12. **Given** a driver whose FCO expires in 75 days, **when** I open Expiries, **then** the FCO is listed as *expiring*, because the CPC warns 90 days ahead.
13. **Given** the interface in English, **when** I switch to French, **then** every label, status and error message of these screens is in French.

## Out of scope

Units and the licence-to-vehicle compatibility check (issue #7); missing documents against order requirements (issues #8 and #9); scanned copies of documents; email or push reminders (issue #13); driving and rest times; telematics; one resource shared between subsidiaries (issue #14).
