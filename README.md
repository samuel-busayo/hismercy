# His Mercy @15 – Personalised Harvest Attendance Poster Generator

**Organisation:** Celestial Church of Christ, His Mercy Parish (Confirm Ministry)  
**Event:** 15th Annual Adult Harvest (*"Harvest of Strength to Strength"*)  
**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, HTML5 Canvas API, MediaPipe Selfie Segmentation

---

## Key Features

- **Mobile-First Experience (90% Phone Users):** Designed for one-thumb mobile operation with a simultaneous Live Preview + Controls layout, auto-magnified bottom panel view, and direct finger drag-to-position.
- **Automatic Browser-Side AI Background Removal:** Automatically removes the visitor's photo background right inside their mobile/desktop browser using locally bundled MediaPipe Selfie Segmentation (`/public/mediapipe/`).
- **Pop-Out Beyond Panel Border Placement:** Allows the visitor's cutout to extend naturally above and beyond the cream panel border while keeping `"I Will Be There"` and the visitor's personalised name cleanly in the foreground.
- **Master Artwork Preservation:** Uses the official `1489 × 2047` harvest flyer (`/flyer-master.jpg`) and official parish logo (`/logo.png`) without altering church branding, guest ministers, or programme details.
- **Download & WhatsApp Sharing:** Exports full-resolution `1489 × 2047` PNG posters (`blob:` URLs for mobile gallery saving and long-press support), native Web Share API file sharing, and WhatsApp invitation sharing.

---

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Push to GitHub & Deploy to Vercel

### 1. Push to GitHub
Create a new repository on [GitHub](https://github.com/new) (for example, `his-mercy-at-15`), then run:

```bash
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to [https://vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. Click **Import** next to your `his-mercy-at-15` repository.
3. Leave all build settings at their defaults (Vercel auto-detects Next.js):
   - **Framework Preset:** Next.js
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`
4. Click **Deploy**. Your live URL will be ready in ~1 minute.
