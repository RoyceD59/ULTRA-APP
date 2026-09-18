-- Starter review queue for the six priority countries. These source reports
-- are historical, so records stay unverified until an administrator confirms
-- current access and publishes them.
INSERT INTO uc_locations (
  id, type, name, address, latitude, longitude, hours, phone, vendor_name,
  country_iso, city, access_notes, municipal, source_attribution,
  active, verified, verified_by, verified_at, created_by
) VALUES
  (
    'seed-wpdx-gh-togbekrom-standpipe-1', 'city_tap', 'Togbekrom Standpipe 1',
    'Togbekrom, Wassa East District, Western Region', 5.570950, -1.686910,
    'Hours not published', NULL, NULL, 'GH', 'Togbekrom',
    'Public piped-water tapstand. The 2018 source report marked it non-functional; confirm repairs, current access, and water safety before publishing.',
    'Wassa East District · contributor: Water4 Public',
    'WPDx/HDX Ghana, Water4_Ghana WassaEast_2016-2021; reported 2018-05-03; WPDx 6CQWH8C7+96P; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_gha; operator: https://water4.org/',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  ),
  (
    'seed-wpdx-ke-manyatta-b-tapstand', 'city_tap', 'Manyatta B Public Tapstand',
    'Manyatta B, Kisumu East, Kisumu County', -0.093122, 34.786072,
    'Hours not published', NULL, NULL, 'KE', 'Kisumu',
    'Metered public piped-water tapstand; the source reported fees collected and functional status. Confirm current tariff, hours, access, and water safety before publishing.',
    'Kisumu Water and Sanitation Company (KIWASCO)',
    'WPDx/HDX Kenya, Virtual Kenya_Busia, Kajiado, Kiambu, Kisumu_2012; reported 2012-05-11; WPDx 6GFPWQ4P+QC4; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_ken; utility jurisdiction: https://kiwasco.co.ke/about-us',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  ),
  (
    'seed-wpdx-tz-isamilo-tapstand', 'city_tap', 'Isamilo Public Tapstand',
    'Isamilo, Nyamagana, Mwanza Region', -2.511950, 32.900200,
    'Hours not published', NULL, NULL, 'TZ', 'Mwanza',
    'Public piped-water tapstand reported functional in 2014. Confirm current operator, access, hours, and water safety before publishing.',
    'Mwanza Urban Water Supply and Sanitation Authority (MWAUWASA)',
    'WPDx/HDX Tanzania, WPDx Reingestion_Global; reported 2014-08-09; WPDx 6G9JFWQ2+63G; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_tza; utility: https://www.mwauwasa.go.tz/',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  ),
  (
    'seed-wpdx-rw-gako-tapstand', 'city_tap', 'Gako Public Tapstand',
    'Gako, Masaka Sector, Kicukiro District', -1.984455, 30.226219,
    'Hours not published', NULL, NULL, 'RW', 'Kigali',
    'Public piped-water tapstand reported functional in 2021. Confirm current access, hours, operator, and water safety before publishing.',
    'Water and Sanitation Corporation (WASAC) · Kicukiro District',
    'WPDx/HDX Rwanda, Water For People_Rwanda_2021; reported 2021-06-14; WPDx 6GCG268G+6F8; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_rwa; utility: https://www.wasac.rw/home',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  ),
  (
    'seed-wpdx-ng-awade-tapstand', 'city_tap', 'Awade Public Tapstand',
    'Awade, Augie Local Government Area, Kebbi State', 12.821510, 4.629467,
    'Hours not published', NULL, NULL, 'NG', 'Awade',
    'No-fee public tapstand supplied by a protected spring. The 2015 source classified it as functional but not in use; confirm current access and water safety before publishing.',
    'Augie LGA · Federal Ministry of Water Resources, Nigeria',
    'WPDx/HDX Nigeria, Federal Ministry of Water Resources_Nigeria_2015; reported 2015-11-24; WPDx 7F46RJCH+JQ4; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_nga',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  ),
  (
    'seed-wpdx-ug-tepwoyo-kiosk', 'city_tap', 'Tepwoyo Water Kiosk',
    'Tepwoyo, Laroo Division, Gulu Municipality', 2.779825, 32.300100,
    'Hours not published', NULL, NULL, 'UG', 'Gulu',
    'Water kiosk reported functional in 2022 under delegated private management. Confirm current operator, tariff, hours, access, and water safety before publishing.',
    'National Water and Sewerage Corporation (NWSC) · Gulu',
    'WPDx/HDX Uganda, YouthMappers_Gulu_Uganda_2022; reported 2022-06-01; WPDx 6GJJQ8H2+W2Q; accessed 2026-09-18; https://data.humdata.org/dataset/wpdx_uga; utility: https://www.nwsc.co.ug/',
    true, false, NULL, NULL, 'seed:wpdx-priority-countries'
  )
ON CONFLICT (id) DO UPDATE SET
  type = EXCLUDED.type,
  name = EXCLUDED.name,
  address = EXCLUDED.address,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  hours = EXCLUDED.hours,
  phone = EXCLUDED.phone,
  vendor_name = EXCLUDED.vendor_name,
  country_iso = EXCLUDED.country_iso,
  city = EXCLUDED.city,
  access_notes = EXCLUDED.access_notes,
  municipal = EXCLUDED.municipal,
  source_attribution = EXCLUDED.source_attribution,
  updated_at = now()
WHERE uc_locations.created_by = 'seed:wpdx-priority-countries'
  AND uc_locations.verified = false;