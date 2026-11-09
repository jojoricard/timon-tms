---
title: "Orders"
subtitle: "Functional specification"
reference: TIMON-SPEC-004
version: "1.1"
date: "November 9, 2026"
status: "Accepted"
---

# TIMON-SPEC-004: Orders

Issue [#8](https://github.com/jojoricard/timon-tms/issues/8). The transport orders the planning will assign to units: entered by hand, imported from a file or generated for the demo, checked as they are entered, and kept with their history.

## Context

Orders reach a haulier by email, phone or EDI, and today they are retyped into a spreadsheet before anyone plans them. The scoping note fixes their shape: one pickup and several deliveries, or several pickups and one delivery, never several of both, so that every product has one origin and one destination. A request with several pickups and several deliveries is two orders merged by mistake, and a person splits it.

This feature records orders with their stops, their goods and their requirements, refuses what cannot be planned (an unlocated site, a delivery before its pickup, the wrong shape), warns about what might go wrong (a slot outside opening hours, a booking not made, a load too heavy for a semi-trailer), and keeps the orders waiting to be planned in one list. Assigning them to units, and checking a unit against their requirements, is the planning (issue #9).

## User stories

- As a dispatcher, I enter an order received by phone in under two minutes, choosing the sites from the address book, so that it is ready to plan.
- As a dispatcher, I import a customer's file of orders, so that I do not retype them.
- As a dispatcher, I am warned when a slot falls outside a site's opening hours or a booking is still to make, so that I fix it before the truck leaves.
- As a dispatcher, I split a request that mixes several pickups and several deliveries into two orders, so that each can be planned.
- As a dispatcher, I see every order waiting to be planned, by date, with its requirements, so that I know tomorrow's work.
- As a customer service agent, I find an order by the customer's reference and see what happened to it, so that I can answer the customer.

<!-- pagebreak -->

## What an order holds

The order and its stops:

| Part | Field | Rule |
| --- | --- | --- |
| Header | Customer | Required, an active customer of SPEC-002 |
| Header | Customer's reference | Optional, the number on the customer's request |
| Header | Notes | Optional, for the dispatchers; not shown to the driver |
| Header | Requirements | Body type (company list), side loading, tail lift: optional, ticked on the order |
| Stop | Kind | Pickup or delivery |
| Stop | Site | Required, an active site of the address book; the customer's usual sites are offered first |
| Stop | Slot | Date, start time and end time, in the site's time zone; the end may fall on the next day |
| Stop | Booking made | Ticked when the site requires a booking and the slot is booked; with its reference, optional |

Each goods line:

| Field | Rule |
| --- | --- |
| Description | Required, e.g. "Yoghurts, 125 g pots" |
| Quantity and packaging | A whole number and one of: Euro pallet (80 × 120), pallet (100 × 120), parcel, bulk |
| Gross weight | Required, in kilograms |
| Floor metres | Optional, to one decimal |
| Dangerous goods | Optional: UN number (four digits) and ADR class (1, 2, 3, 4.1, 4.2, 4.3, 5.1, 5.2, 6.1, 6.2, 7, 8, 9) |
| Temperature | Optional: a range in °C, from −30 to +30, minimum not above maximum |
| From and to | The pickup it leaves from and the delivery it goes to |

The side that is single carries every goods line: with one pickup, each line names its delivery; with one delivery, each line names its pickup. A site does not have to be among the customer's usual sites.

## Requirements

An order's requirements are what a unit must offer to run it. They come from three places and are shown together on the order, each with where it comes from:

| Requirement | Comes from |
| --- | --- |
| ADR: certificate for the driver, approval for the vehicle | A goods line with dangerous goods |
| Temperature control, ATP certificate, the tightest range of the lines | A goods line with a temperature |
| Temperature control for each range, with its lines | Goods lines that share no range |
| Body type, side loading, tail lift | Ticked on the order |
| Tail lift or crane | A stop at a site without a loading dock |
| Protective equipment, maximum length and weight, semi-trailers accepted | The sites of the stops (SPEC-002) |

This feature records and shows them. The planning (issue #9) compares them with a unit's capabilities, documents and protective equipment on the date of the mission.

## Status

| Status | Meaning |
| --- | --- |
| **To plan** | Complete and valid; waiting for a unit |
| **To review** | Imported with something to fix: several pickups and several deliveries, or a site that is not located |
| **Cancelled** | Will not run; kept with its reason |

*Planned*, *in progress* and *delivered* come with the planning and the driver app. A to-review order becomes to plan when it is saved without anything left to fix. An order is never deleted: it is cancelled, with a reason. A cancelled order is read only; it can be duplicated.

## Checks when an order is saved

Blocking, the order cannot be saved as to plan:

- a site that is not located (ADR-004);
- a delivery slot that ends before the start of the pickup slot its goods leave from;
- several pickups and several deliveries;
- a missing required field, or a goods line with no pickup or no delivery.

Warnings, shown on the order and in the list, never blocking:

- a slot outside the site's opening hours;
- a site that requires a booking, with the booking not ticked;
- a total gross weight over 25,000 kg, the usual payload of a semi-trailer;
- more than 13.6 floor metres in total, the length of a semi-trailer's deck;
- goods lines with no common temperature range: they need a multi-temperature body or two orders;
- a customer's reference already used by another order of the same customer that is not cancelled, unless both orders come from the split of one order.

The capacity of the unit itself is checked by the planning, against the vehicle chosen.

## Splitting an order

A to-review order with several pickups and several deliveries has a **Split** action. The dispatcher sorts its goods lines into two groups; each group takes the stops its lines use and must have a single pickup or a single delivery. The first group stays in the original order, which keeps its number; the second becomes a new order. Both histories record the split. If a group still has the wrong shape, it is split again. Nothing is split automatically.

The orders split from one order, however many times, form a family: each records the order the family was first split from. They share the customer's reference, so the warning of a reference already used leaves out the orders of the same family.

## Numbering and history

Each order gets a Timon number, `CMD-` followed by the year of creation and a sequence per company, e.g. `CMD-2026-000123`. Numbers only grow and are never reused.

The history of an order lists, with their date and time: its creation (by hand, by import with the file name, or by the demo generator), each change with the fields changed, each change of status with its reason, a split and a duplication. Each entry has an author, empty until authentication exists.

## Business rules

1. An order has one or more pickups and one or more deliveries, and never more than one of both once to plan.
2. Every goods line has exactly one pickup and one delivery of its order, and every stop has at least one goods line.
3. A slot ends after it starts; its date and times are in the site's time zone.
4. A delivery slot ends after the start of the pickup slot of each line it receives.
5. The total gross weight and floor metres are the sum of the lines: with one pickup, everything is on board when leaving; with one delivery, everything is on board when arriving.
6. Orders are never deleted. Cancelling asks for a reason and a confirmation. A cancelled order is read only.
7. An order follows ADR-005: every change of an existing order checks its version.
8. Archiving a customer or a site that an order to plan or to review uses is refused, naming the orders.

## Import

The same path as SPEC-001 and SPEC-002: download a CSV template, upload a file, preview each line with its errors, confirm. One line per goods line; lines with the same customer code and customer's reference form one order, and their header columns must agree.

| Column | Content |
| --- | --- |
| customer_code, customer_reference | The customer and its reference; the reference groups the lines |
| pickup_site, delivery_site | A site of the address book, by its exact name |
| pickup_date, pickup_from, pickup_to | The pickup slot: dd/mm/yyyy (or yyyy-mm-dd) and hh:mm |
| delivery_date, delivery_from, delivery_to | The delivery slot |
| description, quantity, packaging, weight_kg, floor_m | The goods line |
| un_number, adr_class, temperature_min, temperature_max | Optional |
| body_type, side_loading, tail_lift, notes | Optional, order level |

A site is found by its exact name once the spaces around it are trimmed; two active sites with that name are an error on the line, never a guess. A line without a customer's reference is an order of its own, shown in the preview with the warning "No reference: one order per line". An unknown customer or site, a missing slot or an invalid value is an error on its line, listed with its line number; nothing is imported until the file is free of errors. An order with several pickups and several deliveries, or with a site that is not located, is imported as to review. The screen lists the accepted values of each column; the template is UTF-8 with a byte order mark. A file holds up to 2,000 lines.

## Demo data

The generator creates about 60 orders over the next seven days from the demo customers and sites, consistent with them: chilled goods for the dairy and the pharmaceutical warehouse, dangerous goods for the agricultural supplier, pallets for the breweries and the DIY store. Among them, one order with several pickups and several deliveries and one with the unlocated site of Saint-Priest, both to review, and a few with warnings.

## Screens

- **Orders**: the orders to plan and to review, from today, sorted by first pickup, as a table (number, customer and reference, first pickup site and slot, last delivery site and slot, goods summary in pallets and kilograms, requirements as labels, warnings, status). Filters by status, dates, customer; a search on numbers and references. Cancelled orders on request.
- **Order form**: the customer and its reference; the shape, *one pickup, several deliveries* or *several pickups, one delivery*; the single stop, then the list of stops on the other side, each with its slot and booking; the goods lines, each tied to its stop; the requirements, with where each comes from; the warnings. Actions: save, duplicate, cancel.
- **Order history**: on the form of an existing order, the list of its entries, newest first.
- **Split**: the goods lines of a to-review order in two columns, the stops each column uses, and whether each has a valid shape.
- **Import**: as for resources, with the order preview grouped by reference.

The screens follow the design system and are in French and English from the first screen. Mockups: [orders](../design/mockups/orders.png), [order form](../design/mockups/order-form.png), [order history](../design/mockups/order-history.png), [split](../design/mockups/order-split.png), [import](../design/mockups/order-import.png).

## Acceptance criteria

1. **Given** the customer Laiterie des Monts du Lyonnais, **when** I enter one pickup at the Hub de Corbas and two deliveries, each with a goods line, and save, **then** the order gets the next `CMD-2026-` number and is to plan.
2. **Given** a new order, **when** I choose the site Plateforme Saint-Priest, quai C, which is not located, **then** the order cannot be saved as to plan and says why.
3. **Given** a pickup on 10/11 from 08:00 to 10:00, **when** I set its delivery on 10/11 from 06:00 to 07:30, **then** the order is refused.
4. **Given** a delivery at the pharmaceutical warehouse in Meyzieu, **when** I set the slot from 12:15 to 13:00, **then** the order warns that the site is closed from 12:00 to 13:30, and can be saved.
5. **Given** a site that requires a booking, **when** I save without ticking the booking, **then** the order warns that a booking is to make.
6. **Given** goods lines of 18,000 kg and 9,000 kg, **when** I save, **then** the order warns that 27,000 kg is over 25,000 kg.
7. **Given** a goods line with UN 2067, class 5.1, **when** I open the requirements, **then** ADR is listed, coming from that line.
8. **Given** goods lines at +2 to +6 °C and +4 to +8 °C, **when** I open the requirements, **then** temperature control from +4 to +6 °C is listed.
9. **Given** a stop at a site without a loading dock, **when** I open the requirements, **then** "tail lift or crane" is listed, coming from that site.
10. **Given** an order to plan, **when** I cancel it, **then** a reason is asked, the order becomes cancelled, read only, and leaves the default list.
11. **Given** a file with two lines sharing a reference, two pickups and two deliveries, **when** I import it, **then** one order is created, to review, with the reason.
12. **Given** that order, **when** I split its lines into two groups with one pickup each, **then** two orders to plan exist, the first keeping the original number, and both histories record the split.
13. **Given** a file with an unknown site on line 7, **when** I preview it, **then** line 7 is listed with that error and nothing can be imported.
14. **Given** an order, **when** I change a slot and save, **then** its history shows the change with the old and new slot.
15. **Given** an order to plan using the Silo de Vienne, **when** I archive the site, **then** it is refused and names the order.
16. **Given** a cancelled order, **when** I duplicate it, **then** a new order to plan opens with the same customer, stops and goods, and the dates to set.
17. **Given** the interface in English, **when** I switch to French, **then** every label, status, warning and message of these screens is in French.

## Out of scope

Assigning orders to units, the planning view and the check of requirements against units (issue #9); statuses after planning; prices, quotes and invoicing; distances and driving times, which need an ADR on routing; the customer portal and EDI; recurring orders, beyond duplication; chartering to a subcontractor (issue #11).
