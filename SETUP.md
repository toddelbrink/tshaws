# SETUP — YouTube Data API key

One-time setup, done by a person in a browser, because it requires signing in to a Google account.

Takes about five minutes. No billing account required.

---

## What this is and is not

This is a **public read-only API key**. It reads publicly available data about any public YouTube channel.

- It does **not** require Trevor's Google account, password, or permission.
- It does **not** give access to Trevor's channel settings, analytics, or private videos.
- It belongs to whoever creates it and reads Trevor's public uploads.

If anyone ever suggests this needs Trevor to log in to something, that is OAuth, which is a different thing and is not needed here.

---

## Steps

1. Go to **console.cloud.google.com** and sign in with a Google account.

2. **Create a project.** Top bar, project dropdown, "New Project." Name it something like `tshaws-site`. Wait for it to finish creating, then make sure it is the selected project in the top bar. This is the step people skip, and then nothing works.

3. **Enable the API.** Left menu: APIs & Services, then Library. Search for **YouTube Data API v3**. Click it, then click **Enable**.

4. **Create the key.** Left menu: APIs & Services, then Credentials. Click **Create Credentials** at the top, then **API key**. It appears immediately. Copy it.

5. **Restrict the key.** Click the key name to edit it.

   - **Application restrictions: leave this set to None.**

     This looks wrong and is not. The key is used from a Vercel serverless function, which is server-side. Website (HTTP referrer) restrictions only work for calls made from a browser, and server-side calls send no referrer, so that setting would break it. IP restriction does not work either, because Vercel's function IPs are not fixed. The key is never exposed to a browser, so this is acceptable.

   - **API restrictions: select "Restrict key" and choose only YouTube Data API v3.**

     This is the restriction that matters. Even if the key leaked, it could do nothing but read public YouTube data.

   Save.

6. **Add it to Vercel.** In the Vercel project for this site: Settings, Environment Variables. Add:

   | Name | Value | Environments |
   |---|---|---|
   | `YOUTUBE_API_KEY` | the key you copied | Production, Preview, Development |

   Redeploy after adding it. Environment variables are read at build and runtime, not injected into an existing deployment.

7. **Never commit the key.** It goes in Vercel's settings and, for local development, a `.env.local` file. Both `.env` and `.env.local` are already in `.gitignore`.

---

## Quota

The free tier is **10,000 units per day**. No billing account, no card.

Costs that matter here:

| Call | Cost | Note |
|---|---|---|
| `playlistItems.list` | **1 unit** | Returns up to 50 videos per call. Use this. |
| `videos.list` | 1 unit | For durations and view counts, up to 50 IDs per call. |
| `search.list` | **100 units** | Avoid. A hundred of these exhausts the entire daily quota. |

**Do not use `search.list` to list a channel's videos.** It costs 100x more and returns less.

The right approach: every YouTube channel has an "uploads" playlist whose ID is the channel ID with the `UC` prefix swapped for `UU`.

- Channel: `UCDS7usPBxVlwfWbM5euFhWQ`
- Uploads playlist: `UUDS7usPBxVlwfWbM5euFhWQ`

Call `playlistItems.list` against that playlist. A 200-video library is four calls, four units. With six-hour caching that is roughly sixteen units a day against a ten thousand unit allowance. This will never cost money and will never hit the ceiling.

---

## Verifying it works

Paste this in a browser, replacing `YOUR_KEY`:

```
https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=5&playlistId=UUDS7usPBxVlwfWbM5euFhWQ&key=YOUR_KEY
```

You should get JSON with five of Trevor's videos. If you get a 403, the API is not enabled on the selected project, or the key restriction is wrong. If you get a 404, the playlist ID is wrong, which means the channel ID needs re-checking.
