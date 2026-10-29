# Red team 4 rig — static renders of every Service Payments state

Renders the Match, Search and Import screens inside a replica of the app shell
(top bar + bottom nav) and screenshots them at five viewports, so a review sees
what a phone shows — including anything the nav covers. No Supabase, no login.

MatchScreen and SearchPanel are the REAL components. The page head, tabs,
empty states, Import preview/done, bottom nav, Create sheet and drawer are
hand-copied replicas (same classes, same strings); `index.json` marks which.

    S=<scratch dir>; cd $S
    npm i react@18.3.1 react-dom@18.3.1 esbuild@0.24.2 playwright-core@1.49.1 lucide-react@1.23.0
    npx esbuild <repo>/scripts/payments/redteam4-rig/render.mjs --bundle --platform=node \
      --format=esm --jsx=automatic --outfile=build/render.bundle.mjs \
      --alias:react=$S/node_modules/react --alias:react-dom=$S/node_modules/react-dom \
      --alias:react/jsx-runtime=$S/node_modules/react/jsx-runtime.js --alias:lucide-react=$S/node_modules/lucide-react
    node build/render.bundle.mjs out      # 46 states → out/<id>.html + out/<id>.txt
    node <repo>/scripts/payments/redteam4-rig/shoot.mjs out   # out/<id>-<viewport>[-s<n>].png

The repo paths inside render.mjs are absolute (`/home/user/parastrucks`); edit
them for another checkout. Chromium path is Playwright's cloud default.
The outputs are not committed.
