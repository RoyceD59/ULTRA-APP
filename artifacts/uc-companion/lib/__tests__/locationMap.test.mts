import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directionsUrls, regionForLocations } from "../locationMap.ts";

const location = { name: "Ultra-Clear Westlands", lat: -1.2633, lng: 36.8072 };

describe("customer location map helpers", () => {
  it("opens a labelled Apple Maps destination on iOS", () => {
    const urls = directionsUrls(location, "ios");
    assert.equal(
      urls.primary,
      "http://maps.apple.com/?daddr=-1.2633%2C36.8072&q=Ultra-Clear%20Westlands",
    );
    assert.match(urls.fallback, /^https:\/\/www\.google\.com\/maps\/dir/);
  });

  it("opens a Google Maps navigation destination on Android", () => {
    const urls = directionsUrls(location, "android");
    assert.equal(
      urls.primary,
      "google.navigation:q=-1.2633%2C36.8072&mode=d",
    );
    assert.match(urls.fallback, /^https:\/\/www\.google\.com\/maps\/dir/);
  });

  it("uses the Google Maps browser URL on web", () => {
    const urls = directionsUrls(location, "web");
    assert.equal(urls.primary, urls.fallback);
    assert.match(urls.primary, /destination=-1.2633%2C36.8072/);
  });

  it("derives a usable padded region for available markers", () => {
    const region = regionForLocations([location]);
    assert.deepEqual(region, {
      latitude: -1.2633,
      longitude: 36.8072,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  });
});