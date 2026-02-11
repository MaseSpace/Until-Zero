# Empires III Prototype

A lightweight browser prototype inspired by territory-conquest board games.

## Play

1. Open `/Users/maselivingston/Documents/Empires III/index.html` in a browser.
2. During **Reinforce**, click your territories to place armies.
3. Click **Start Attacks**.
4. In **Attack**:
   - Click one of your territories with more than 1 army.
   - Click an adjacent enemy territory.
   - Click **Attack**.
5. Click **End Turn** to let AI play.
6. Control all territories to win.

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
