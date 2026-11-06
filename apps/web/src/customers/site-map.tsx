import 'leaflet/dist/leaflet.css';
import type { Bounds } from '@timon/domain';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { m } from '../paraglide/messages.js';

// Leaflet and its stylesheet live in this module only, loaded by the site form when it opens:
// no other screen pays for the map. Tiles come from OpenStreetMap, credited on the map.

type Point = { latitude: number; longitude: number };

const tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const attribution =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** The pin, drawn in CSS: no image to serve, in the colours of the design system. */
const pin = L.divIcon({
  className: 'site-pin',
  html: '<span aria-hidden="true"></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
});

/** Lyon, where the demo haulier works, when there is nothing to centre on. */
const fallback: Point = { latitude: 45.75, longitude: 4.85 };

const latLngBounds = (area: Bounds) =>
  L.latLngBounds([area.south, area.west], [area.north, area.east]);

export default function SiteMap({
  location,
  area,
  onPlace,
}: {
  location: Point | null;
  /**
   * The site's country, to look at while the site is not located (SPEC-002, Locating a site).
   * The map moves to it again when the country changes.
   */
  area?: Bounds | undefined;
  /** The pin was dropped or dragged: the site is now located by hand. */
  onPlace: (point: Point) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const place = useRef(onPlace);
  place.current = onPlace;
  const shownArea = useRef(area);

  // The map is created once per form; later changes move the pin in the effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: created once, on mount.
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { scrollWheelZoom: false });
    if (location) instance.setView([location.latitude, location.longitude], 17);
    else if (area) instance.fitBounds(latLngBounds(area));
    else instance.setView([fallback.latitude, fallback.longitude], 10);
    L.tileLayer(tiles, { attribution, maxZoom: 19 }).addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) => {
      place.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const areaChanged = area !== shownArea.current;
    shownArea.current = area;
    if (!location) {
      marker.current?.remove();
      marker.current = null;
      if (area && areaChanged) instance.fitBounds(latLngBounds(area));
      return;
    }
    const latLng = L.latLng(location.latitude, location.longitude);
    if (marker.current) {
      marker.current.setLatLng(latLng);
    } else {
      const created = L.marker(latLng, {
        draggable: true,
        icon: pin,
        keyboard: true,
        title: m.map_label(),
        alt: m.map_label(),
      }).addTo(instance);
      created.on('dragend', () => {
        const point = created.getLatLng();
        place.current({ latitude: point.lat, longitude: point.lng });
      });
      marker.current = created;
    }
    if (!instance.getBounds().pad(-0.2).contains(latLng)) instance.setView(latLng, 17);
  }, [location, area]);

  return <div ref={element} className="site-map" role="application" aria-label={m.map_label()} />;
}
