# T Shaw's Progressive Bluegrass

Website for Trevor Shaw's podcast and YouTube channel.

Static site. Deployed on Vercel. Served at `tshaws.elbrink.com`.

## Structure

```
/index.html          Home
/episodes/           Full episode archive with player
/guests/             Everyone who has been on the show
/videos/             YouTube library
/about/              Trevor and the show
/api/episodes        Serverless: parses the ZenCast RSS, returns JSON
/api/videos          Serverless: YouTube Data API proxy, hides the key
/assets/             Logo and imagery
/test/               Node tests. Not deployed.
/tools/              One-off scripts. Not deployed.
```

## Tests

```
node test/guests.js                the guest-line parser, offline
node test/guests.js --live         the same, plus the live feed

node test/watch-buttons.js         Watch button resolution, offline
node test/watch-buttons.js --live  the same, plus a per-episode report
```

No test framework and no dependencies. Each test loads the shipped browser
script against a stub DOM, so it tests the file that actually runs in the
browser: `assets/js/guests.js` for guests, `assets/js/epvideo.js` for Watch.

`node test/watch-buttons.js --live --report` prints only the report: which
episodes carry Watch, which are Listen only, and the video id behind each one.

## Exports

```
node tools/export-videos-csv.js
```

Writes `exports/tshaws-videos-<date>.csv`, one row per video, for Trevor's
YouTube title cleanup. The `_guess` columns are guesses and the uppercase
columns are his to fill. The export is not committed; it goes stale as soon as
he edits a title. Takes about a minute cold, ten seconds warm.

## Deployment

Vercel project `tshaws`, linked to this repo. Push to `main` deploys automatically.

- Live: https://tshaws.elbrink.com
- `tshaws.vercel.app` redirects to the subdomain.

## Local development

```
node tools/devserver.js
```

Serves the repo on http://localhost:8787 and proxies `/api` to production, so
the real feed and the real playlist exercise the shipped JS without a YouTube
key on this machine. Sends `no-store`, so a verification run never exercises the
previous edit. `vercel dev` also works and runs the functions locally.

## Environment

`YOUTUBE_API_KEY` must be set in Vercel project settings. Never commit it.
