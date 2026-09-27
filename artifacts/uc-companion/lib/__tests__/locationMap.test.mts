import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directionsUrls, filterMapLocations, regionForLocations } from "../locationMap.ts";

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

  it("returns a reactivated reviewed tap under the shared Taps and All filters", () => {
    const reactivatedReviewedTap = {
      id: "reviewed-starter-tap",
      type: "city_tap",
      name: "Reviewed Starter Tap",
      address: "Market Road",
      lat: -1.2864,
      lng: 36.8172,
      hours: "Daily, 06:00–20:00",
      countryIso: "KE",
      city: "Nairobi",
      accessNotes: "Use the public tap beside the market entrance.",
      municipal: "Nairobi City Water",
      sourceAttribution: "Starter tap field survey",
    };
    const locations = [
      reactivatedReviewedTap,
      { id: "kenya-centre", type: "experience_centre" },
      { id: "kenya-atm", type: "water_atm" },
      { id: "kenya-vendor", type: "vendor" },
      { id: "rwanda-station", type: "refill_station" },
    ];

    // Web and native map screens both use this helper over the public endpoint payload.
    assert.deepEqual(filterMapLocations(locations, "Taps"), [reactivatedReviewedTap]);
    assert.equal(filterMapLocations(locations, "All").includes(reactivatedReviewedTap), true);
    for (const filter of ["Centres", "ATMs", "Vendors", "Stations"] as const) {
      assert.equal(filterMapLocations(locations, filter).includes(reactivatedReviewedTap), false);
    }
    assert.equal(reactivatedReviewedTap.city, "Nairobi");
    assert.equal(reactivatedReviewedTap.municipal, "Nairobi City Water");
    assert.equal(reactivatedReviewedTap.sourceAttribution, "Starter tap field survey");
    assert.match(reactivatedReviewedTap.accessNotes, /market entrance/);
  });
});