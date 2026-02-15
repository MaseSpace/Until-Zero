# Until Zero

A lightweight browser prototype inspired by territory-conquest board games.

## Play

1. Start the LAN server:
   - `node lan-server.js`
2. Open `http://<host-ip>:8080` in a browser.
   - For local testing on one machine, use `http://localhost:8080`.
   - For LAN multiplayer, every player must open the host machine IP/port in their browser.
3. In the setup wizard choose `Network Play`:
   - Host: choose settings, pick country, set max players (2-4), and optionally disable AI (`LAN Only`).
   - Joiners: browse hosted lobbies, preview host settings (read-only), join, and pick an unclaimed country.
4. Host launches once at least 2 players are connected and all countries are selected.
5. During a LAN match, end turn hands off to the next connected LAN commander.

## Local-only mode (legacy)

You can still open `/Users/maselivingston/Documents/Empires III/index.html` directly for solo play, but LAN lobby discovery/sync requires the server above.

## Core controls

1. During **Reinforce**, click your territories to place armies.
2. Click **Start Attacks**.
3. In **Attack**:
   - Click one of your territories with more than 1 army.
   - Click an adjacent enemy territory.
   - Click **Attack**.
4. Click **End Turn** to let AI play.
5. Control all territories to win.

## Rules in this prototype

- 21 connected world regions based on real country shapes (forming real-world continents).
- Reinforcements each turn: `max(3, floor(territories_owned / 3))`.
- Attacks use Risk-style dice comparison.
- Attack force slider lets you choose how many armies to commit.
- Simple AI reinforces randomly and performs up to 3 favorable attacks.

## Next upgrades

- Add continents and bonus reinforcements.
- Add multi-player hotseat.
- Add map visualization with SVG edges.
- Add card system and turn objectives.
