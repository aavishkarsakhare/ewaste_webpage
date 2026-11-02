# RETRACK – EPR Tracker (hackathon prototype)

Tracks electronics batches through their recycling lifecycle and flags suspicious data.

## Run locally
1. Install Node.js (any recent version). No other packages needed.
2. In this folder run: `node backend/server.js`
3. Open http://localhost:3000

## Lifecycle
Registered → Sold/Distributed → Collected → Handed to Recycler → Recycled → Certified

## Known limitations
No real login (role dropdown), JSON file storage, rule-based checks only, not deployed.
To reset demo data: `git checkout data/batches.json`
