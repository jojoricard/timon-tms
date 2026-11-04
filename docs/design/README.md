# Timon: Visual identity and mockups

The brand guidelines are a 12-page document: [timon-brand-guidelines.pdf](timon-brand-guidelines.pdf). Their source is [`guidelines/index.html`](guidelines/index.html), printed from Chromium in A4 landscape.

Timon is used all day by dispatchers. The interface stays quiet so the planning carries the information; identity comes from a few signature elements rather than decoration.

![Planning screen: order well, resources grouped by family, three-day horizon, an order being dragged onto a compatible unit.](mockups/planning.png)

## Principles

- **The planning is the interface.** Neutral chrome, so colour always means something: an assignment, a status, a conflict.
- **Show the trade, not a calendar.** A row is a real resource with its unit composition, capabilities and deadlines. Orders, rests, maintenance and washing share the same time axis.
- **A conflict is never missed, and never comes alone.** Overlapping orders split the row into two lanes over a hatched area, and every conflict comes with costed solutions.
- **Space goes to working hours.** Night hours (21:00–05:00) are compressed to a quarter of their width.
- **Dense, not cramped.** 14px text, 32px controls, 60px planning rows; data compared across rows is set in a monospaced face with tabular figures.

## Signature elements

| Element | Where | Why |
| --- | --- | --- |
| The coupling ring | Logo, application bar | The ring of a drawbar (*timon*) replaces the o of the name |
| Unit links | Each planning row | Tractor and trailer drawn as parts joined by a short bar; a missing driver is a dashed link |
| Brass time line | Planning, time header | The only use of the accent colour besides the logo |
| Load curve | Time header | Busy resources per two-hour slot, peaks in orange |
| Two-lane conflict | Planning rows | Overlap shown as geometry, not only as a badge |

## Colour

Light theme first, dark theme supported; every token has both values. Text contrast is at least 4.5:1 in both themes.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `surface` | `#FBFAF8` | `#15181A` | App background |
| `surface-raised` | `#FFFFFF` | `#1C2023` | Panels, rows, cards |
| `ink` | `#1B1F22` | `#ECEAE6` | Text |
| `petrol` | `#0E5B63` | `#5BB8BC` | Brand, primary action, orders in progress |
| `brass` | `#8A6220` | `#D4A452` | Current time, logo ring |
| `ok` | `#2A7448` | `#5CC28A` | Delivered, valid |
| `warning` | `#9A5B00` | `#E0A040` | Late, expiring |
| `conflict` | `#B3261E` | `#F07A70` | Conflict, expired |
| `chartered` | `#6A4C9C` | `#B49AE6` | Subcontracted |
| `chrome` | `#15181A` | `#0F1213` | Application bar, in both themes |

The complete set (33 colours, type, spacing, radii, sizes, shadows, breakpoints) is in [`tokens.json`](tokens.json), the exported source the code will read.

## Typography

IBM Plex Sans for the interface, IBM Plex Sans Condensed inside planning bars, IBM Plex Mono for plates, references, times and quantities. All three are open source (SIL Open Font License).

## Breakpoints

Every screen works from 390 to 1,920 px. Layouts change at five widths, the same everywhere. Media and container queries cannot read CSS variables, so these values are written in the stylesheets and a test checks that no query uses any other.

| Token | Width | Measured on | Use |
| --- | --- | --- | --- |
| `narrow` | 640 px | Window | Below it, a phone: tighter page margins, the application bar scrolls sideways |
| `medium` | 1,024 px | Window | Below it, cards side by side stack in one column |
| `wide` | 1,600 px | Window | From it, the unit form keeps period and documents beside the candidate lists, and the units screen keeps the free resources beside the table |
| `form-2` | 480 px | Card | A form grid in a card wider than this has two columns, one below |
| `form-4` | 880 px | Card | A document or contact row wider than this keeps its fields on one line; opening hours keep the day bar beside the ranges |

A table wider than the window scrolls inside its frame, with its first column held in place; the page itself never scrolls sideways. Tables and tabs that scroll show a shade (`shadow-edge`) on each edge with more to show. The main lists fit their frame from 1,280 px, status badges taking a second line when their column is narrow. Plates, codes, dates and times never wrap.

## Components

The interface is built from 28 components:

- **Planning**: planning row, order bar (8 states), unit links, time header, order card, bulk-action bar
- **Navigation**: application bar, page header, tabs, segmented control
- **Forms**: button, search field, checkbox, radio card
- **Overlays**: hover card, context menu, detail panel
- **Content**: card, data table, meter, deadline list, activity log, itinerary, conflict banner, metric, tag, status badge
- **Brand**: wordmark

## Mockups

The interface is designed in French and English; the mockups here are the English version, the French one lives in the design files. They show the target product with realistic data for a haulier near Lyon. Some elements belong to later phases of the [roadmap](../scoping.md#roadmap): driving times read from the tachograph, live vehicle position, proofs sent from the driver app.

| Screen | File |
| --- | --- |
| Planning, while dragging an order | [planning.png](mockups/planning.png) |
| Planning with the detail panel of an order in conflict | [planning-detail-panel.png](mockups/planning-detail-panel.png) |
| Planning, dark theme | [planning-dark.png](mockups/planning-dark.png) |
| Hover on an order, hover on a driver, right-click menu | [planning-interactions.png](mockups/planning-interactions.png) |
| Order, full page | [order.png](mockups/order.png) |
| Driver record | [driver.png](mockups/driver.png) |
| Resources, drivers tab ([SPEC-001](../specs/0001-resources.md)) | [resources.png](mockups/resources.png) |
| Resource form, a tractor and its documents | [resource-form.png](mockups/resource-form.png) |
| Expiries across all resources | [expiries.png](mockups/expiries.png) |
| CSV import, check step with errors | [resource-import.png](mockups/resource-import.png) |
| Customers ([SPEC-002](../specs/0002-customers-and-sites.md)) | [customers.png](mockups/customers.png) |
| Customer form, contacts and usual sites | [customer-form.png](mockups/customer-form.png) |
| Sites, the shared address book | [sites.png](mockups/sites.png) |
| Site form, location, opening hours and requirements | [site-form.png](mockups/site-form.png) |
| Sites CSV import, check and locate step | [site-import.png](mockups/site-import.png) |
| Driver form, protective equipment held | [driver-protective-equipment.png](mockups/driver-protective-equipment.png) |
| Units at a date and the resources free ([SPEC-003](../specs/0003-units.md)) | [units.png](mockups/units.png) |
| Unit form, with the resources that cannot be chosen and why | [unit-form.png](mockups/unit-form.png) |
| Changing the driver of a unit from a date | [unit-change.png](mockups/unit-change.png) |
| Units of a resource, past and running | [unit-history.png](mockups/unit-history.png) |

![Order in conflict: solutions, route on the A7, goods, price and margin, emissions under ISO 14083.](mockups/order.png)

## Logo

The name in IBM Plex Sans SemiBold, outlined, with the o replaced by the brass coupling ring of a drawbar. The letters follow the text colour; the ring is always brass.

| File | Use |
| --- | --- |
| [`logo/timon-logo.svg`](logo/timon-logo.svg) | Light backgrounds |
| [`logo/timon-logo-on-dark.svg`](logo/timon-logo-on-dark.svg) | Dark backgrounds, application bar |
| [`logo/timon-logo-on-petrol.svg`](logo/timon-logo-on-petrol.svg) | Petrol backgrounds |
| [`logo/timon-icon.svg`](logo/timon-icon.svg) | Icon on its tile: favicon, app icon, avatar (16 to 64 px) |
| [`logo/timon-mark.svg`](logo/timon-mark.svg) | The ring and drawbar alone, on light backgrounds |

Keep the ring's diameter free around the logo; never narrower than 72 px, use the icon below that. Usage rules are on pages 3 and 4 of the [brand guidelines](timon-brand-guidelines.pdf).
