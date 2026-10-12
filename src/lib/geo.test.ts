import { describe, it, expect } from "vitest";
import { distanceMeters, findNearestSite, resolveRadii } from "./geo";
import type { GeoCandidate } from "./geo";

const SITE = (id: string, lat: number, lng: number, radiusMeters: number): GeoCandidate => ({
  id,
  name: `Site ${id}`,
  lat,
  lng,
  radiusMeters,
});

describe("distanceMeters", () => {
  it("returns 0 for identical coordinates", () => {
    expect(distanceMeters(27.7172, 85.324, 27.7172, 85.324)).toBe(0);
  });

  it("gives a plausible distance for ~1 degree of latitude", () => {
    const d = distanceMeters(27, 85, 28, 85);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("findNearestSite", () => {
  const sites = [
    SITE("a", 27.7172, 85.324, 300),
    SITE("b", 27.7000, 85.3300, 500),
    SITE("c", 27.6800, 85.3400, 150),
  ];

  it("matches the nearest site inside its radius", () => {
    const fix = { lat: 27.7174, lng: 85.324, accuracy: 15 };
    const match = findNearestSite(fix, sites);
    expect(match).not.toBeNull();
    expect(match!.site.id).toBe("a");
    expect(match!.distanceMeters).toBeLessThan(50);
  });

  it("returns null when outside every site radius", () => {
    const fix = { lat: 27.9, lng: 85.5, accuracy: 15 };
    expect(findNearestSite(fix, sites)).toBeNull();
  });

  it("picks the nearest when multiple sites contain the fix", () => {
    // Two close sites; the midpoint fix sits inside both radii → nearest wins.
    const nearby = [
      SITE("l", 27.7100, 85.3250, 150),
      SITE("r", 27.7120, 85.3255, 150),
    ];
    const fix = { lat: 27.7110, lng: 85.3252, accuracy: 15 };
    const match = findNearestSite(fix, nearby);
    expect(match).not.toBeNull();
    expect(match!.site.id).toBe("l");
    expect(match!.distanceMeters).toBeLessThan(120);
    expect(match!.distanceMeters).toBeGreaterThan(0);
  });

  it("rejects a fix whose accuracy exceeds a site radius", () => {
    const fix = { lat: 27.7174, lng: 85.324, accuracy: 500 }; // within "a" but too imprecise
    expect(findNearestSite(fix, sites)).toBeNull();
  });

  it("can disable the accuracy gate", () => {
    const fix = { lat: 27.7174, lng: 85.324, accuracy: 500 };
    const match = findNearestSite(fix, sites, false);
    expect(match).not.toBeNull();
  });

  it("ignores sites with no radius", () => {
    const noRadius = [{ ...SITE("x", 27.7172, 85.324, 0) }];
    const fix = { lat: 27.7174, lng: 85.325, accuracy: 15 };
    expect(findNearestSite(fix, noRadius)).toBeNull();
  });

  it("returns null for an empty site list", () => {
    const fix = { lat: 27.7174, lng: 85.325, accuracy: 15 };
    expect(findNearestSite(fix, [])).toBeNull();
  });
});

describe("resolveRadii", () => {
  const SITE_RAW = (id: string, lat: number, lng: number, radiusMeters?: number) =>
    ({ id, name: `Site ${id}`, lat, lng, radiusMeters } as GeoCandidate & { radiusMeters?: number });

  it("applies the company default to an outlet with no radius of its own", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324)];
    expect(resolveRadii(sites, 150)[0].radiusMeters).toBe(150);
  });

  it("keeps a per-outlet override instead of the default", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324, 40)];
    expect(resolveRadii(sites, 150)[0].radiusMeters).toBe(40);
  });

  it("treats a zero or null radius as inherit", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324, 0), SITE_RAW("b", 27.7, 85.33, null as unknown as number)];
    expect(resolveRadii(sites, 120).map(s => s.radiusMeters)).toEqual([120, 120]);
  });

  it("resolves a mix of overridden and inheriting outlets", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324), SITE_RAW("b", 27.7, 85.33, 60)];
    expect(resolveRadii(sites, 150).map(s => s.radiusMeters)).toEqual([150, 60]);
  });

  it("leaves radii untouched when the default is non-positive", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324, 300)];
    expect(resolveRadii(sites, 0)[0].radiusMeters).toBe(300);
  });

  it("does not mutate the input sites", () => {
    const sites = [SITE_RAW("a", 27.7172, 85.324, 300)];
    resolveRadii(sites, 150);
    expect(sites[0].radiusMeters).toBe(300);
  });

  it("widens coverage for an outlet that inherits a larger default", () => {
    const sites = [SITE_RAW("inherits", 27.7172, 85.324)]; // no radius of its own
    const fix = { lat: 27.7174, lng: 85.3250, accuracy: 20 }; // ~110m out
    // With no default to fall back on the outlet is unusable...
    expect(findNearestSite(fix, resolveRadii(sites, 0))).toBeNull();
    // ...but it inherits the company default and now covers the fix.
    expect(findNearestSite(fix, resolveRadii(sites, 150))!.site.id).toBe("inherits");
  });

  it("a tight override still blocks a fix the default would have allowed", () => {
    const sites = [SITE_RAW("tight", 27.7172, 85.324, 40)];
    const fix = { lat: 27.7174, lng: 85.3250, accuracy: 20 }; // ~110m out
    expect(findNearestSite(fix, resolveRadii(sites, 150))).toBeNull();
  });
});

describe("multi-outlet clock-in matching", () => {
  // Four outlets spread over Kathmandu, all sharing one 150m radius.
  const outlets = [
    SITE("head-office", 27.7172, 85.3240, 150),
    SITE("baneshwor-site", 27.7000, 85.3300, 150),
    SITE("pokhara-site", 28.2096, 83.9856, 150),
    SITE("biratnagar-site", 26.4525, 87.2718, 150),
  ];

  it("identifies the correct outlet at each location", () => {
    const cases: Array<[string, { lat: number; lng: number }]> = [
      ["head-office", { lat: 27.7174, lng: 85.3241 }],
      ["baneshwor-site", { lat: 27.7001, lng: 85.3301 }],
      ["pokhara-site", { lat: 28.2097, lng: 83.9857 }],
      ["biratnagar-site", { lat: 26.4526, lng: 87.2719 }],
    ];
    for (const [expected, coords] of cases) {
      const match = findNearestSite({ ...coords, accuracy: 15 }, outlets);
      expect(match, `expected a match near ${expected}`).not.toBeNull();
      expect(match!.site.id).toBe(expected);
    }
  });

  it("blocks clock-in when far from every outlet", () => {
    const fix = { lat: 27.9, lng: 86.0, accuracy: 15 }; // between outlets, nowhere near
    expect(findNearestSite(fix, outlets)).toBeNull();
  });
});