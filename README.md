# Alpenfisch

A peer-to-peer 3D fishing game set on a big, fast glacial river in a Swiss alpine valley. Built with three.js. There's no build step, and every model and texture is procedural.

## Run

```bash
node server.js
```

Then open http://localhost:5173. Multiplayer uses WebRTC through the public PeerJS broker, so you need an internet connection to host or join a lobby. Solo play works offline once the three.js CDN files are cached.

## Play together

1. One player clicks **Host a lobby** and shares the 5-letter code.
2. Friends type the code and click **Join**.
3. Everyone sees each other's Weidling boats, rods, lines, lures and hooked fish live. Chat with Enter. Catches are announced to the lobby.

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

## Selling and upgrades

After landing a fish, keep it (K) and it goes into the boat's crate. The crate is saved between sessions. Steer to the dock or any bank and press E to go ashore, then walk to the **Fischerei** stall next to the dock to sell your catch for francs. Rarer and heavier fish fetch more.

Spend the money on:

- **Outboard upgrades**, from Stock 15 hp to the 60 hp Edelweiss with up to +135% thrust. Each upgrade repaints the hull: alpine green, Swiss red, glacier blue, then midnight blue. Other players see your colour.
- **Braided line**, which raises the line's breaking strain from 7.2 kg to 10.5 kg.

Your wallet, upgrades and crate are stored in the browser.

## Code map

- `src/world/`: river definition (flow and habitat), terrain and splat shader, water shader, sky, forests, grass, village layout and ambient life
- `src/models/`: procedural fish, Weidling boat, angler, rod and reel, lures, chalets and cows
- `src/game/`: boat physics, fishing rig, fish AI, effects, HUD, audio, ambience, remote players and `land.js` (walking, shop, wallet, upgrades)
- `src/net/network.js`: PeerJS lobby, with the host relaying between guests
- `preview/*.html`: standalone viewers for each model set and the world
