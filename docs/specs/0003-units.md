---
title: "Units"
subtitle: "Functional specification"
reference: TIMON-SPEC-003
version: "0.1"
date: "October 27, 2026"
status: "Draft"
---

# TIMON-SPEC-003: Units

Issue [#7](https://github.com/jojoricard/timon-tms/issues/7). The combinations of a power unit, a driver and a trailer that the planning works with, over a period of time, and the licence check that decides who may drive what.

## Context

A dispatcher does not plan a tractor, then a driver, then a trailer. He plans *Marc Laurent with CD-456-EF and SR-4471*: a unit, the central object of the scoping note. Most units are long-lived, a driver keeps his tractor for months; some exist for one mission, a trailer borrowed for a day. Today this pairing lives in the dispatcher's head or on a whiteboard, and nothing stops him from putting a driver with a C1 licence behind a 44-tonne tractor.

This feature records units with their period of validity, refuses a resource in two units at the same time, refuses a driver who does not hold the licence the unit needs, and shows, for any date, who drives what and what is left free. The planning (issue #9) will assign orders to these units.

## User stories

- As a dispatcher, I put a driver, a power unit and a trailer together from a date, so that the planning shows them as one row.
- As a dispatcher, I pair a trailer with a unit for one mission only, so that it is free again afterwards.
- As a dispatcher, I change a unit's driver or trailer from a given date, so that the history stays true and the planning knows who drove what.
- As a dispatcher, I see which resources are free on a date, so that I know what I can still use.
- As a fleet manager, I am stopped when a driver does not hold the licence a vehicle needs, so that it never reaches the road.

<!-- pagebreak -->

## What a unit holds

| Field | Rule |
| --- | --- |
| Power unit | Required: a tractor, a rigid truck or a light van |
| Trailer | Optional: a semi-trailer behind a tractor, a drawbar trailer behind a rigid truck |
| Driver | Optional |
| Start | Date and time, to the minute, in the company's time zone (Europe/Paris) |
| End | Optional; left empty for a unit that lasts until changed. The unit ends at that minute, not after it |
| Name | Optional, e.g. "Unit 5"; by default the unit is named after its driver, or its power unit's plate |

A unit has one power unit and at least one other resource. The possible units are those of the scoping note:

| Power unit | With a driver | With a trailer | With both |
| --- | --- | --- | --- |
| Tractor | Yes | Yes, a semi-trailer | Yes |
| Rigid truck | Yes | Yes, a drawbar trailer | Yes |
| Light van | Yes | No | No |

A light van takes no trailer here: it would need a BE licence, which is not among the licence categories of SPEC-001. A unit without a driver is planned all the same; the planning will show it as needing one.

## The licence a unit needs

The category comes from the gross vehicle weights recorded in SPEC-001, not from the regulatory category N1, N2 or N3:

| The unit | Licence needed |
| --- | --- |
| Power unit up to 3,500 kg | B |
| Power unit over 3,500 kg and up to 7,500 kg | C1 |
| Power unit over 7,500 kg | C |
| C1 power unit with a trailer over 750 kg, the two together up to 12,000 kg | C1E |
| Any other power unit over 3,500 kg with a trailer over 750 kg, and any tractor with a semi-trailer | CE |

A trailer up to 750 kg does not change the category. A higher category covers the lower ones: C covers C1, CE covers C1E and C, C1E covers C1. A driver holds a category when his record has a driving licence document for it (SPEC-001), whatever its expiry date: an expired licence is a document to renew, reported as below, not a missing category.

## Documents of the members

On the unit's start date, or today for a unit already running, the unit shows the status of every document its members need, as defined in SPEC-001: the licence, the CPC and the driver card for a vehicle over 3,500 kg, the roadworthiness test, the tachograph inspection. The unit's status is the worst of them, and the next expiry within the unit's period is shown with it.

Here these statuses never block. A unit that lasts months will see documents expire and be renewed; whether a resource may run a given mission is checked mission by mission, on its date, by the planning (issue #9). A required document that was never recorded shows as *missing*.

## Business rules

1. A unit has exactly one power unit and at least one driver or trailer. A semi-trailer goes behind a tractor only, a drawbar trailer behind a rigid truck only; a light van takes a driver only.
2. All the resources of a unit are active and belong to the same subsidiary (SPEC-001, rule 7).
3. The end, when given, is after the start. Periods are half-open: a unit ending at 20:00 and another starting at 20:00 do not overlap.
4. A resource belongs to at most one unit at any moment. A unit that would overlap another on any of its resources is refused, and the message names the other unit and its period.
5. The driver must hold the category the unit needs (see above). Otherwise the unit is refused, and the message says which category is needed and which the driver holds.
6. Units are never edited in place once started. Changing the driver or the trailer from a date ends the current unit at that minute and starts a new one with the same other members, in one step. A unit that has not started yet can be edited or deleted; a started unit can only be given an end.
7. A resource that belongs to a running or future unit cannot be archived; the message names the unit.

## Screens

- **Units**: the units valid at a date and time, now by default, as a table (unit name, power unit, trailer, driver, since, until, status), grouped by kind of power unit. A date picker moves through time, including the past.
- **Free on this date**: beside the table, the drivers, power units and trailers that belong to no unit at that moment, each with a button to start a unit from it.
- **Unit form**: the power unit, then the trailer and the driver, each chosen in a list that shows only active resources free over the whole period; resources that cannot be chosen stay visible, greyed, with the reason ("Holds C1, needs CE", "In Unit 5 until 20/10 18:00", "Semi-trailer: needs a tractor"). Below, the period, then the documents of the members with their status.
- **Change driver or trailer**: from a running unit, a dialog that asks for the date and time and the new resource, and shows the two units that will result.
- **Resource form**: a "Units" section added to the forms of SPEC-001, listing the resource's units, past, running and future.

The screens follow the design system and are in French and English from the first screen. Mockups come in the next revision of this document.

## Acceptance criteria

1. **Given** the tractor CD-456-EF (44,000 kg combination), the semi-trailer SR-4471 and Marc Laurent, who holds C and CE, **when** I create a unit from 06/10/2026 06:00 with no end, **then** it is saved and the Units screen shows it today.
2. **Given** Élodie Marchand, who holds C1 only, **when** I add her to a unit with CD-456-EF, **then** the form refuses it: "Needs CE, Élodie Marchand holds C1".
3. **Given** a rigid truck of 7,490 kg, **when** I put Élodie Marchand on it alone, **then** the unit is saved; **when** I add a drawbar trailer of 3,500 kg, **then** it is refused because the unit needs C1E.
4. **Given** a rigid truck, **when** I choose a semi-trailer for it, **then** the form refuses it; **given** a light van, **then** no trailer can be chosen.
5. **Given** a power unit, **when** I save a unit with neither a driver nor a trailer, **then** the form refuses it.
6. **Given** SR-4471 in a unit from 06/10/2026 06:00 with no end, **when** I create another unit with SR-4471 from 20/10/2026 08:00, **then** it is refused and the message names the first unit.
7. **Given** a trailer in a unit on 20/10/2026 from 08:00 to 20:00, **when** I put it in another unit from 18:00 to 22:00, **then** it is refused; **from 20:00 to 22:00**, **then** it is saved.
8. **Given** Marc Laurent's unit, **when** I change its driver to Hugo Perrin from 26/10/2026 06:00, **then** the Units screen shows Marc Laurent on 25/10 at 18:00 and Hugo Perrin on 26/10 at 08:00, with the same tractor and trailer, and Marc Laurent appears under "Free on this date" on 26/10.
9. **Given** a driver whose FCO expired last week, **when** I put him in a unit, **then** the unit is saved, shows the status *expired* and names the FCO.
10. **Given** a unit starting next Monday, **when** I delete it, **then** it no longer exists; **given** a running unit, **then** it cannot be deleted, only given an end.
11. **Given** a trailer in a running unit, **when** I archive the trailer, **then** it is refused and the message names the unit.
12. **Given** the interface in English, **when** I switch to French, **then** every label, reason and message of these screens is in French.

## Out of scope

Assigning orders to units and the planning view (issue #9); the check of order and site requirements against a unit's capabilities and protective equipment (issues #8 and #9); driving and rest times; activities that block a resource such as maintenance or washing (with the planning); the gross combination weight check, a warning to add later; a unit shared between subsidiaries (issue #14); recurring patterns such as a weekly rotation of drivers.
