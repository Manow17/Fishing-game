# Alpenfisch

A peer-to-peer 3D fishing game with two maps: a big, fast glacial river in a Swiss alpine valley, and an open ocean with sharks and giant fish. Built with three.js. There's no build step, and every model and texture is procedural.

## Run

```bash
node server.js
```

Then open http://localhost:5173. Multiplayer uses WebRTC through the public PeerJS broker, so you need an internet connection to host or join a lobby. Solo play works offline once the three.js CDN files are cached.

## Play together

1. One player clicks **Host a lobby** and shares the 5-letter code.
2. Friends type the code and click **Join**.
3. Everyone sees each other's boats, anglers, rods, lines, lures and hooked fish live. Chat with Enter. Catches are announced to the lobby.

- **Crew up:** stop next to a friend's boat and press **E** to hop aboard. You sit on one of their passenger seats and can fish from there while they drive. **G** takes you back to your own boat.
- **Lobby owner:** the host picks the map and sets the wave size in Settings (**O**). Guests follow automatically; when the host changes the map, everyone reloads into the new one and rejoins the same code.
- Works from GitHub Pages too: the whole folder is static files.

## Controls

| | |
|---|---|
| W / S | Throttle up / down (X = idle) |
| A / D | Steer the outboard (while fighting a fish: side pressure) |
| Q | Drop / raise anchor |
| F | Toggle fishing ↔ driving |
| Hold LMB → release | Charge and cast (release in the marked zone) |
| Space (in flight) | Stop the line early |
| Hold LMB | Reel (Shift = fast retrieve) |
| RMB | Strike / set the hook, jerk the rod (twitch lures, free snags); hold to lift the rod while fighting |
| Mouse wheel | Drag setting |
| 1–4 | Spinner, spoon, minnow wobbler, worm & float |
| E | Net the fish once it's close and tired · go ashore near the dock or a bank · board the boat · open the shop |
| WASD / Shift (on land) | Walk / run |
| C | First / third person while fishing |
| E (next to a friend's boat) / G | Hop aboard / back to your own boat |
| U | Werkstatt: customise your angler and boat |
| O | Settings: map, waves (lobby owner), graphics |
| J / H | Journal / help |
| Enter | Chat |

## Fishing model

- **River:** each point has its own flow speed, depth and habitat. The current is fastest mid-river, there are two rapids with standing waves, deep pools sit on the outside of bends, and boulders leave slack water behind them.
- **Species:** ten Swiss species: brown and rainbow trout, grayling, arctic char, pike, perch, huchen, whitefish, barbel and chub. Each has its own habitat, depth, lure preferences, size range, fighting power and jumping habits.
- **Lures:** they drift with the current, sink or dive, and swing across the current on a tight line. Fish only bite when the retrieve speed suits the lure, or when the bait drifts naturally under the float.
- **Fight:** a force-based simulation. Line tension comes from line and rod stretch. Drag slips line and screams, the line snaps past its breaking strain, and a slack line can throw the hook. Side pressure tires the fish faster, and an exhausted fish rolls onto its side near the surface.

## The valley

The river runs for 5.7 km from north (upstream) to south. Spots, in the order you meet them heading downstream:

- **Gorge:** 46 m rock walls, wild rapids and a waterfall. It takes some throttle to get up there.
- **Gletscherbach-Altwasser:** a calm side river on the east bank. It has no current and winds through its own little valley to a pond.
- **Rapids above the village:** the village itself has the church, the cows and the dock, with a Fischerei stall beside it.
- **Second set of rapids:** a smaller gorge, with the Giessen side river on the west bank a little further down.
- **Lake:** a deep, slow lake with two wooded islands and a second village with a dock and its own Fischerei.

Calm side waters and the lake suit pike, perch, chub and whitefish. Fast seams and boulders hold the trout.

## The ocean

The second map is open sea around a harbour island. Big swells move the boat, and the fish are huge: great white, hammerhead and mako sharks, blue marlin, swordfish, bluefin and yellowfin tuna, mahi-mahi, giant grouper and barracuda. Reefs and drop-offs near the island hold the grouper and barracuda; the open deep water is where the sharks, billfish and tuna roam. Ocean tackle is much heavier (90 kg line, 600 m spool). Giants pull harder than your drag, take line on long runs and keep swimming away between runs, so you pump them in; a 500 kg marlin takes about two minutes. Fish over 80 kg are gaffed instead of netted. Big fish sell well, but not so well that one catch buys the whole shop.

## Werkstatt (customisation)

Press **U** (or the button in the menu) to customise for free, with a live 3D preview:

- **Angler:** skin, hair style and colour, beard, glasses, hat style and colour, vest or jacket, shirt, trousers and boots.
- **Boat:** three types (the wooden Weidling with a tiller outboard, a mahogany runabout with a wheel, and a centre-console sport-fisher), a size slider from ×0.7 to ×1.6, hull paint and stripe colour.

Bigger boats are heavier and slower to turn but ride the waves better. Other players see your look.

## Waves and graphics

The lobby owner's wave slider goes from glassy calm to storm. The boat floats on the real wave surface: it heaves, pitches and rolls with the swell, slams into big waves and gets pushed down their faces. Graphics presets (Performance, Balanced, Sharp, Ultra) set the render resolution, and an optional sharpening pass keeps distant grass and trees crisp.

## Selling and upgrades

After landing a fish, keep it (K) and it goes into the boat's crate. The crate is saved between sessions. Steer to the dock or any bank and press E to go ashore, then walk to the **Fischerei** stall next to the dock to sell your catch for francs. Rarer and heavier fish fetch more.

Spend the money on:

- **Outboard upgrades**, from Stock 15 hp to the 60 hp Edelweiss with up to +135% thrust. They work on every boat type.
- **Braided line**, which raises the line's breaking strain from 7.2 kg to 10.5 kg.

Your wallet, upgrades, crate and look are stored in the browser.

## Code map

- `src/world/env.js`: the map interface (water surface, waves, flow, depth, habitat, bounds, species) that boat physics, fishing and fish AI read
- `src/world/`: river definition (flow and habitat), terrain and splat shader, water shader, sky, forests, grass, village layout and ambient life
- `src/world/ocean/`: the ocean map: island terrain, ocean water and waves, harbour, flora and sky
- `src/models/`: procedural fish (river and ocean), three boat types, customisable angler, rod and reel, lures, chalets and cows
- `src/game/`: boat physics, fishing rig, fish AI, effects, HUD, audio, ambience, remote players, `land.js` (walking, shop, wallet, upgrades), `look.js` / `workshop.js` (customisation), `rigging.js` (building and seating boats and anglers) and `settings.js`
- `src/net/network.js`: PeerJS lobby, with the host relaying between guests
- `preview/*.html`: standalone viewers for each model set and the world
