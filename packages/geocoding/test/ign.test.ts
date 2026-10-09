import { GeocoderUnavailableError } from '@timon/app';
import { describe, expect, it } from 'vitest';
import { createIgnGeocoder, createRateLimiter } from '../src/index.ts';

// No network: `fetch` is replaced by a function that answers like the service did on
// 8 October 2026 for "2 avenue de l'Europe 78140 Vélizy-Villacoublay".
const answer = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.218975, 48.784357] },
      properties: {
        label: "2 Avenue de l'Europe 78140 Vélizy-Villacoublay",
        score: 0.97,
        housenumber: '2',
        name: "2 Avenue de l'Europe",
        postcode: '78140',
        city: 'Vélizy-Villacoublay',
        type: 'housenumber',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [4.88366, 45.526486] },
      properties: {
        label: 'Vienne',
        score: 0.95,
        name: 'Vienne',
        postcode: '38200',
        city: 'Vienne',
        type: 'municipality',
      },
    },
  ],
};

const noLimit = { acquire: async () => {} };

describe('createIgnGeocoder', () => {
  it('asks the address index and reads candidates with their precision', async () => {
    const urls: string[] = [];
    const geocoder = createIgnGeocoder({
      limiter: noLimit,
      fetch: async (url) => {
        urls.push(String(url));
        return Response.json(answer);
      },
    });
    const candidates = await geocoder.search("2 avenue de l'Europe", {
      country: 'FR',
      limit: 5,
      autocomplete: true,
    });
    expect(new URL(urls[0] ?? '').searchParams.toString()).toBe(
      'q=2+avenue+de+l%27Europe&index=address&limit=5&autocomplete=1',
    );
    expect(candidates).toEqual([
      {
        label: "2 Avenue de l'Europe 78140 Vélizy-Villacoublay",
        street: "2 Avenue de l'Europe",
        postcode: '78140',
        city: 'Vélizy-Villacoublay',
        country: 'FR',
        latitude: 48.784357,
        longitude: 2.218975,
        precision: 'address',
        score: 0.97,
      },
      expect.objectContaining({ precision: 'city', street: '', city: 'Vienne' }),
    ]);
  });

  it('turns a refusal, a network failure or a timeout into GeocoderUnavailableError', async () => {
    const options = { country: 'FR', limit: 1, autocomplete: false };
    const refused = createIgnGeocoder({
      limiter: noLimit,
      fetch: async () => new Response('', { status: 429 }),
    });
    await expect(refused.search('x', options)).rejects.toBeInstanceOf(GeocoderUnavailableError);
    const offline = createIgnGeocoder({
      limiter: noLimit,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(offline.search('x', options)).rejects.toBeInstanceOf(GeocoderUnavailableError);
    const slow = createIgnGeocoder({
      limiter: noLimit,
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await expect(slow.search('x', options)).rejects.toBeInstanceOf(GeocoderUnavailableError);
  });
});

describe('createRateLimiter', () => {
  it('lets 40 requests through in a second and holds the 41st for the next', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = createRateLimiter(40, {
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });
    for (let i = 0; i < 40; i += 1) await limiter.acquire();
    expect(waits).toEqual([]);
    now = 250;
    await limiter.acquire();
    expect(waits).toEqual([750]);
    expect(now).toBe(1000);
  });

  it('serves concurrent callers in order', async () => {
    let now = 0;
    const limiter = createRateLimiter(2, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => limiter.acquire().then(() => order.push(n))));
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(now).toBe(2000);
  });
});
