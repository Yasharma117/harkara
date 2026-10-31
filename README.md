# Harkara

Daily AI war broadcast where every order is a courier who can be caught. See `../Harkara — Build Spec.md`.

Cycle 0 (grey box): deterministic engine, scripted generals, 2D viewer.

    npm test            # golden replays + courier gate (≥3 interceptions, ≥1 readable decode)
    npm run battle 4    # writes client/public/replay/grey-4
    npm run dev         # viewer at localhost:5173, pick a battle with #grey-2
