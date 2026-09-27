export interface PriorityLocationSeed {
  id: string;
  type: "city_tap";
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  hours: string;
  phone: null;
  vendorName: null;
  countryIso: string;
  city: string;
  accessNotes: string;
  municipal: string;
  sourceAttribution: string;
}

/**
 * Review queue sourced from the Water Point Data Exchange country datasets.
 *
 * These records are intentionally seeded as unverified. Source reports describe
 * conditions on their collection dates, not current availability or water
 * quality, so a ProjectHub administrator must assess and verify each point
 * before the public locations API can publish it.
 */
export const PRIORITY_LOCATION_SEEDS: readonly PriorityLocationSeed[] = [
  {
    id: "seed-wpdx-gh-togbekrom-standpipe-1",
    type: "city_tap",
    name: "Togbekrom Standpipe 1",
    address: "Togbekrom, Wassa East District, Western Region",
    latitude: 5.57095,
    longitude: -1.68691,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "GH",
    city: "Togbekrom",
    accessNotes: "Public piped-water tapstand. The 2018 source report marked it non-functional; confirm repairs, current access, and water safety before publishing.",
    municipal: "Wassa East District · contributor: Water4 Public",
    sourceAttribution: "WPDx/HDX Ghana, Water4_Ghana WassaEast_2016-2021; reported 2018-05-03; WPDx 6CQWH8C7+96P; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_gha; operator: https://water4.org/",
  },
  {
    id: "seed-wpdx-ke-manyatta-b-tapstand",
    type: "city_tap",
    name: "Manyatta B Public Tapstand",
    address: "Manyatta B, Kisumu East, Kisumu County",
    latitude: -0.093122,
    longitude: 34.786072,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "KE",
    city: "Kisumu",
    accessNotes: "Metered public piped-water tapstand; the source reported fees collected and functional status. Confirm current tariff, hours, access, and water safety before publishing.",
    municipal: "Kisumu Water and Sanitation Company (KIWASCO)",
    sourceAttribution: "WPDx/HDX Kenya, Virtual Kenya_Busia, Kajiado, Kiambu, Kisumu_2012; reported 2012-05-11; WPDx 6GFPWQ4P+QC4; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_ken; utility jurisdiction: https://kiwasco.co.ke/about-us",
  },
  {
    id: "seed-wpdx-tz-isamilo-tapstand",
    type: "city_tap",
    name: "Isamilo Public Tapstand",
    address: "Isamilo, Nyamagana, Mwanza Region",
    latitude: -2.51195,
    longitude: 32.9002,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "TZ",
    city: "Mwanza",
    accessNotes: "Public piped-water tapstand reported functional in 2014. Confirm current operator, access, hours, and water safety before publishing.",
    municipal: "Mwanza Urban Water Supply and Sanitation Authority (MWAUWASA)",
    sourceAttribution: "WPDx/HDX Tanzania, WPDx Reingestion_Global; reported 2014-08-09; WPDx 6G9JFWQ2+63G; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_tza; utility: https://www.mwauwasa.go.tz/",
  },
  {
    id: "seed-wpdx-rw-gako-tapstand",
    type: "city_tap",
    name: "Gako Public Tapstand",
    address: "Gako, Masaka Sector, Kicukiro District",
    latitude: -1.984455,
    longitude: 30.226219,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "RW",
    city: "Kigali",
    accessNotes: "Public piped-water tapstand reported functional in 2021. Confirm current access, hours, operator, and water safety before publishing.",
    municipal: "Water and Sanitation Corporation (WASAC) · Kicukiro District",
    sourceAttribution: "WPDx/HDX Rwanda, Water For People_Rwanda_2021; reported 2021-06-14; WPDx 6GCG268G+6F8; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_rwa; utility: https://www.wasac.rw/home",
  },
  {
    id: "seed-wpdx-ng-awade-tapstand",
    type: "city_tap",
    name: "Awade Public Tapstand",
    address: "Awade, Augie Local Government Area, Kebbi State",
    latitude: 12.82151,
    longitude: 4.629467,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "NG",
    city: "Awade",
    accessNotes: "No-fee public tapstand supplied by a protected spring. The 2015 source classified it as functional but not in use; confirm current access and water safety before publishing.",
    municipal: "Augie LGA · Federal Ministry of Water Resources, Nigeria",
    sourceAttribution: "WPDx/HDX Nigeria, Federal Ministry of Water Resources_Nigeria_2015; reported 2015-11-24; WPDx 7F46RJCH+JQ4; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_nga",
  },
  {
    id: "seed-wpdx-ug-tepwoyo-kiosk",
    type: "city_tap",
    name: "Tepwoyo Water Kiosk",
    address: "Tepwoyo, Laroo Division, Gulu Municipality",
    latitude: 2.779825,
    longitude: 32.3001,
    hours: "Hours not published",
    phone: null,
    vendorName: null,
    countryIso: "UG",
    city: "Gulu",
    accessNotes: "Water kiosk reported functional in 2022 under delegated private management. Confirm current operator, tariff, hours, access, and water safety before publishing.",
    municipal: "National Water and Sewerage Corporation (NWSC) · Gulu",
    sourceAttribution: "WPDx/HDX Uganda, YouthMappers_Gulu_Uganda_2022; reported 2022-06-01; WPDx 6GJJQ8H2+W2Q; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_uga; utility: https://www.nwsc.co.ug/",
  },
] as const;