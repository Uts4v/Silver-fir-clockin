import { describe, it, expect } from "vitest";
import { distanceMeters, findNearestSite } from "./geo";
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