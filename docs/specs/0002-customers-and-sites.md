---
title: "Customers and sites"
subtitle: "Functional specification"
reference: TIMON-SPEC-002
version: "0.1"
date: "October 8, 2026"
status: "Draft"
---

# TIMON-SPEC-002 — Customers and sites

Issue [#6](https://github.com/jojoricard/timon-tms/issues/6). Who orders the transport, where goods are picked up and delivered, and what each place requires from the vehicle and the driver who come to it.

## Context

An order names a customer and at least two sites. Today the dispatcher retypes the same addresses order after order, and the constraints of each site live in his head: the warehouse that only takes rigid trucks, the plant where nobody gets in without safety shoes, the store that must be booked the day before. A driver turned away at the gate costs a wasted trip and often a penalty.

This feature gives Timon a customer file and a shared address book of sites, each located on the map and carrying its opening hours and requirements. Orders (issue #8) will pick from both; units and the planning (issues #7 and #9) will check the requirements against the vehicle and the driver.

The ordering customer is rarely the place being delivered: a logistics platform receives goods for a dozen shippers, a store chain is delivered on behalf of its suppliers. Sites therefore belong to the company, not to a customer, and a customer only keeps a list of the sites it usually uses.

## User stories

- As a dispatcher, I record a customer once with its legal identity and contacts, so that orders and invoices point to the right entity.
- As a dispatcher, I record a site once with its address, located on the map, so that every order uses the same place and distances can be computed.
- As a dispatcher, I record a site's opening hours and requirements, so that nobody sends a semi-trailer to a site that only takes rigid trucks.
- As a dispatcher, I attach the sites a customer usually uses, so that entering its orders takes a few clicks.
- As a fleet manager taking over an existing activity, I import customers and sites from CSV files.
- As a dispatcher, I record the protective equipment each driver holds, so that a site's requirements can be checked against it later.

<!-- pagebreak -->

## What a customer holds

| Field | Rule |
| --- | --- |
| Name | Legal name, required |
| Code | Short code used in lists and orders (e.g. "DUPONT-IDF"), required, unique in the company, upper case |
| Country | Required, France by default |
| SIRET | France only, optional: 14 digits with a valid check digit, unique among active customers |
| VAT number | Optional; for a French customer with a SIRET, Timon proposes the number computed from the SIREN |
| Billing address | Street lines, postcode, city, country |
| Contacts | Any number: name, role, phone, email; at least a phone or an email |
| Usual sites | Sites from the address book, in any number, each usable for pickups and deliveries |
| Notes | Free text |

Customers belong to the company, not to a subsidiary: when a subsidiary charters an order to another one, the order keeps its customer (scoping, *Chartering*).

## What a site holds

| Field | Rule |
| --- | --- |
| Name | Required, e.g. "Vélizy warehouse — north dock" |
| Address | Street lines, postcode, city, country; a French postcode has five digits |
| Location | Latitude and longitude, from the address or placed by hand on the map; the site shows how it was located |
| Time zone | Europe/Paris by default, taken from the country otherwise; opening hours are in this time zone |
| Opening hours | For each day of the week, closed or one or more time ranges |
| Booking | Whether a time slot must be booked before coming, and how: phone, email or web portal |
| Protective equipment | Items from the company list every person entering must wear |
| Access | Maximum vehicle length, maximum gross weight, whether a loading dock exists, whether semi-trailers are accepted |
| Contact | Phone at the gate or the reception, optional |
| Instructions | Free text shown to the driver, e.g. "Gate 3, report at the security lodge" |

Protective equipment is a company list seeded with safety shoes, high-visibility vest, hard hat, safety glasses and gloves, editable later. A site without a loading dock implies that the vehicle needs a tail lift or a crane; the check itself comes with units (issue #7).

<!-- pagebreak -->

## Locating a site

When the country is France, typing the address proposes matching addresses from the national address base, served by the IGN geocoding service. Choosing one fills the street, postcode, city and location. When nothing matches, when the site is abroad, or when the point is wrong (the entrance of a large plant is rarely at its postal address), the dispatcher places or moves the pin on the map.

The site records how it was located: *address* (the exact number was found), *street* or *city* (only an approximate match), or *by hand*. A site may be saved without a location, for instance while the geocoding service cannot be reached; it is then marked *not located*. An order will not accept a site that is not located (issue #8).

## Protective equipment held by drivers

This extends SPEC-001. A driver's form gains the list of protective equipment the driver holds, as boxes to tick from the same company list. No dates and no documents: the equipment is either held or not. Comparing it with the requirements of the sites on a trip belongs to the planning checks (issue #9).

## Business rules

1. A customer code is unique in the company, archived customers included, and compared without case. A SIRET is unique among active customers.
2. A SIRET has fourteen digits and a valid check digit (Luhn; establishments of La Poste follow their own rule). The VAT number Timon proposes is `FR`, the key `(12 + 3 × (SIREN mod 97)) mod 97` on two digits, then the SIREN. The dispatcher can change it.
3. A contact needs a name and at least a phone or an email. A removed contact is deleted, not archived: personal data is not kept once it is no longer needed.
4. Within one day, opening ranges do not overlap and each ends after it starts; `24:00` is a valid end. A site open overnight has two ranges, one ending at `24:00`, the next starting at `00:00` on the following day.
5. A site within 50 metres of an active site, or with the same street line, postcode and country (ignoring case, accents and punctuation), raises a warning naming that site. It does not block: two docks of one warehouse may be two sites.
6. Customers and sites are never deleted once they exist; they are archived, hidden by default and can be restored. Archiving a customer does not archive its usual sites, which other customers may use.
7. A CSV import is all or nothing, as for resources: if one line is invalid, nothing is imported and every error is listed with its line number. A French site without coordinates is located during the preview; a site that cannot be located is not an error, it is imported as *not located* and the preview says so.

<!-- pagebreak -->

## Screens

- **Customers**: a searchable table (code, name, city, SIRET, number of usual sites), a "show archived" toggle, a button to add, a button to import.
- **Customer form**: identity and billing address, contacts as rows, then the usual sites with a search in the address book and a button to create a new site without leaving the form.
- **Sites**: a searchable table (name, postcode and city, country, today's opening hours, booking, protective equipment as icons, location status), a filter "not located", buttons to add and to import.
- **Site form**: address with suggestions, a map with a pin that can be moved, the opening hours as a week grid, requirements, access and instructions.
- **Import**: the import screen of SPEC-001, with a template for customers and one for sites.
- **Driver form**: the protective equipment block added to the existing form.

The screens follow the design system and are in French and English from the first screen. Mockups come in the next revision of this document.

## Acceptance criteria

1. **Given** a new French customer, **when** I type the SIRET 404 833 048 00015, **then** the form refuses it because the check digit is wrong; **when** I type 404 833 048 00014, **then** it is accepted and the VAT number FR83404833048 is proposed.
2. **Given** an active customer with SIRET 404 833 048 00014, **when** I create another customer with the same SIRET, **then** the form refuses it and names the existing customer.
3. **Given** a customer coded "DUPONT-IDF", archived, **when** I create a customer coded "dupont-idf", **then** the form refuses the code.
4. **Given** a contact with a name only, **when** I save the customer, **then** the form asks for a phone or an email.
5. **Given** a site in France, **when** I type "1 avenue de l'Europe 78140 Vélizy" and choose the suggestion, **then** street, postcode, city and location are filled and the site is located by *address*.
6. **Given** a site in Germany, **when** I place the pin on the map and save, **then** the site is located *by hand* and its time zone is Europe/Berlin.
7. **Given** the geocoding service cannot be reached, **when** I save a French site, **then** it is saved as *not located* and appears under the "not located" filter.
8. **Given** an active site, **when** I create another site 30 metres away, **then** a warning names the first site and I can still save.
9. **Given** a site's Monday hours 06:00–12:00 and 11:00–18:00, **when** I save, **then** the form refuses the overlap; **given** 22:00–24:00 on Monday and 00:00–05:00 on Tuesday, **then** the site is saved.
10. **Given** a site used by two customers, **when** I archive one of them, **then** the site stays active and is still a usual site of the other.
11. **Given** a customer with two contacts, **when** I remove one and save, **then** that contact no longer exists anywhere, archived lists included.
12. **Given** a CSV of 300 sites where line 42 has the postcode "7814" for France, **when** I upload it, **then** nothing is imported and the preview shows "line 42: postcode must have five digits".
13. **Given** a valid CSV of 300 French sites without coordinates, one of which matches no address, **when** I confirm, **then** 300 sites exist, 299 located and one *not located*.
14. **Given** a driver, **when** I tick safety shoes and high-visibility vest and save, **then** the driver's form and list show both items.
15. **Given** the interface in English, **when** I switch to French, **then** every label, message and opening-hours format of these screens is in French.

## Out of scope

Delivery slots and their check against opening hours (issue #8); the check of site requirements and protective equipment against units and drivers (issues #7 and #9); exceptional closures and public holidays; distances and routing; customer prices and invoicing; the customer portal; one customer or site restricted to a subsidiary (issue #14).
