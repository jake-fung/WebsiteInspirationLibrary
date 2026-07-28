import { chromium } from 'playwright';
import { join } from 'node:path';

const VIEWPORT = { width: 1440, height: 900 };
const MAX_SCREENSHOT_HEIGHT = 6000;
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Runs inside the browser. Must be self-contained — it cannot close over
 * anything in this module. Exported so tests can evaluate it directly.
 */
export const EXTRACT_FACTS = () => {
  const toHex = (rgb) => {
    const m = rgb.match(/\d+/g);
    if (!m) return null;
    return (
      '#' +
      m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    );
  };

  const describe = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      sizePx: Math.round(parseFloat(s.fontSize)),
      weight: s.fontWeight,
    };
  };

  const body = document.body;
  const bodyStyle = getComputedStyle(body);

  // Accent colours: text colours that differ from the dominant body colour.
  const dominant = toHex(bodyStyle.color);
  const counts = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const hex = toHex(getComputedStyle(el).color);
    if (!hex || hex === dominant) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const accents = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hex]) => hex);

  const nav = document.querySelector('nav, header nav, [role="navigation"]');
  let navPattern = 'none';
  if (nav) {
    const display = getComputedStyle(nav).display;
    navPattern = display === 'flex' || display === 'grid' ? 'horizontal' : 'stacked';
  }

  // Widest constrained content container on the page.
  let maxContentWidthPx = null;
  for (const el of document.querySelectorAll('main, section, div, article')) {
    const mw = getComputedStyle(el).maxWidth;
    if (mw && mw !== 'none') {
      const px = Math.round(parseFloat(mw));
      if (!Number.isNaN(px) && (maxContentWidthPx === null || px > maxContentWidthPx)) {
        maxContentWidthPx = px;
      }
    }
  }

  return {
    fonts: {
      heading: describe(document.querySelector('h1, h2')),
      body: describe(body),
    },
    colors: {
      background: toHex(bodyStyle.backgroundColor),
      text: dominant,
      accents,
    },
    layout: {
      navPattern,
      sectionCount: document.querySelectorAll('section').length,
      maxContentWidthPx,
    },
  };
};

export async function captureSite(url, { outDir, id, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (cause) {
    throw new Error(
      'Could not launch Chromium. Run `npx playwright install chromium` and try again.',
      { cause }
    );
  }

  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch (cause) {
      throw new Error(
        `Could not load ${url}. The site may be slow, offline, or blocking automated ` +
          'browsers. Try opening it and screenshot it yourself, then drop the image ' +
          'in instead.',
        { cause }
      );
    }

    const facts = await page.evaluate(EXTRACT_FACTS);

    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const imagePath = join(outDir, `${id}.png`);
    await page.screenshot({
      path: imagePath,
      clip: {
        x: 0,
        y: 0,
        width: VIEWPORT.width,
        height: Math.min(fullHeight, MAX_SCREENSHOT_HEIGHT),
      },
    });

    return { imagePath, facts };
  } finally {
    await browser.close();
  }
}
