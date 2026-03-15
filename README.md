# Fathom

Explore the universe by drilling into Wikidata's "has part" (P527) relationships. Start at **Q1 (universe)** and click through bouncing balls to discover what everything is made of.

## How it works

- Each entity's P527 ("has part") claims are fetched from the Wikidata API
- Parts appear as bouncy balls inside a physics circle (powered by Matter.js)
- Click a ball or use the sidebar to navigate deeper
- Images are pulled from Wikimedia Commons when available
- The title links to the English Wikipedia article (or Wikidata if none exists)

## How to play

- **Click a ball** to explore that entity's parts
- **Reset** to return to Q1
- **Shake** to give the balls a random nudge
- Try to reach the deepest depth you can

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Built with

- [Next.js](https://nextjs.org)
- [Matter.js](https://brm.io/matter-js/)
- [Wikidata API](https://www.wikidata.org/wiki/Wikidata:Data_access)
- [Tailwind CSS](https://tailwindcss.com)
