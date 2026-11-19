# Site Grade – Cut/Fill

Mobile web app for checking dirt grades with a rotating laser and a grade rod.
Hosted on GitHub Pages; works offline after the first load.

**Current version: v1.5.3** – adds "Home test (yard)" project (Google Earth image, 3 pins pre-set so the GPS dot works right away); – ◉ button on the plan shows/hides the orange spot points

## How it works
1. **Setup** – shoot the benchmark (e.g. slab F.F.E.). App computes laser HI = BM elevation + rod reading.
2. **Plan** – tap where you're standing (or tap an orange target point), enter the plan elevation,
   pick the offset (how far dirt sits below the plan elevation, e.g. 12" under top of curb), and the rod reading.
3. App shows **CUT / FILL / ON GRADE** and drops a color-coded pin on the plan.

Math: target dirt = plan elev − offset; actual dirt = HI − rod; cut(+)/fill(−) = actual − target.

Spot elevations can be typed short (`14.33` → `1014.33`) using the project's elevation prefix.

## Design surface + state plane (v1.5)
- **v1.5.1:** WoodSpring Douglasville has Harper's PROPOSED surface (`surfaces/woodspring-fg.json`), tied to state plane
  using the plan's spot grades (median difference 0.05 ft).
- Home 2 Douglasville has HRC's Civil 3D **FG (finished grade) surface** (`surfaces/home2-fg.json`, from the LandXML)
  and the plan is tied to **NAD83 Georgia West state plane** (`georef` in projects.json).
- **GPS dot works with no control points.** GPS lat/long → state plane → plan. Capturing 1+ control point only removes
  the GPS datum shift (often 2–4 ft); capture one building corner for best results.
- **GPS target = design surface** at the spot you're standing (finished grade). Set a depth for dirt with
  Set target → offset chip → *Use design surface instead*. A typed target overrides it until you switch back.
- **Laser shots:** tapping the plan fills in the finished grade from the surface automatically.

## Projects (v1.4)
- **Home 2 Suites Douglasville** – GP1 grading plan, slab F.F.E. 1015.50.
- **WoodSpring Suites Douglasville** (690 McPherson Rd, HE-2325) – C-2 grading plan, F.F.E. 941.00, elevation prefix 900.
  65 target points pre-loaded from the stamped PDF: 55 curb/pavement spot grades, 7 inlet/structure tops, 3 retaining-wall bottoms.
  Points were read off a scanned PDF – positions are within a few feet; check any that matter against the plan.
- Projects live in `projects.json`; pick one in Setup → Project. Shots, captures and calibration stay on each device.

## GPS elevation (v1.3) – RTK rover
- Rover (LG290P + GNSS Master mock location) feeds position **and elevation** to the tablet.
- Setup → **Calibrate on benchmark** (or the panel's *Calibrate on slab*): pole on the slab F.F.E., 5 s average.
  Offset = benchmark − GPS height, so pole height and ellipsoid/geoid difference cancel. Keep pole height fixed afterward.
- Plan tab (Shoot mode, GPS on): live **Ground** elevation and **CUT/FILL** vs. the target.
- Target = nearest orange target point within 10 ft (automatic) or one you type (*Set target*: plan elevation + offset).
- **Record shot** saves a GPS shot (pin, log, CSV with lat/long and accuracy). Warns when not RTK Fixed.

## GPS on the plan (v1.2)
- Control points (purple crosshairs, **📍 Cal** mode) tie the plan to GPS. Defaults: the 4 building corners.
- Tap a crosshair, stand on that spot, **Capture GPS here** (averages ~20 s). Need 2+, 3–4 is better.
- Move / rename / add / delete control points any time; you can also type lat/long.
- **📍** button: tap once = GPS on + follow, tap again after panning = re-center, tap while following = off.
- "Lock to plan scale" uses the plan's 1"=30' (`planFtPerPx` in projects.json) so only position + rotation come from GPS.
- Phone GPS is typically ±10–15 ft. Feed an RTK receiver into the phone's location (Android mock location) for inch-level.

## Adding a project
1. Export the grading plan sheet as a JPG (~4000 px wide) into `plans/`.
2. Add an entry to `projects.json` (name, plan path, image size, planFtPerPx, benchmark, elevPrefix, control, points).
3. Add the plan path to the `SHELL` list in `sw.js` and bump `CACHE` + `VERSION` in `index.html`.

## Target points
Add them in the app with **+ Point**, then *Setup → Export points*. Paste the exported `points`
array into the project in `projects.json` so every phone gets them.

## Releasing an update
Bump `VERSION` in `index.html` and `CACHE` in `sw.js` together so phones pick up the new build.
