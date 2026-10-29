/**
 * GET /api/news — merged fitness, nutrition and health headlines.
 *
 * Reads the publishers' own RSS feeds rather than scraping them: scraping
 * breaks on markup changes and republishing scraped article text is
 * infringement. This runs server-side because feeds do not send
 * Access-Control-Allow-Origin, so the browser cannot fetch them directly.
 *
 * Only the headline, the publisher's own summary and an outbound link are
 * passed through. Nothing here reproduces an article.
 */

const { XMLParser } = require('fast-xml-parser');

const FEEDS = [
  { id: 'sbs',     name: 'Stronger By Science', tag: 'Research',  url: 'https://www.strongerbyscience.com/feed/' },
  { id: 'bbm',     name: 'Barbell Medicine',    tag: 'Medicine',  url: 'https://www.barbellmedicine.com/feed/' },
  { id: 'sigma',   name: 'Sigma Nutrition',     tag: 'Nutrition', url: 'https://sigmanutrition.com/feed/' },
  { id: 'pn',      name: 'Precision Nutrition', tag: 'Nutrition', url: 'https://www.precisionnutrition.com/feed' },
  { id: 'stat',    name: 'STAT News',           tag: 'Health',    url: 'https://www.statnews.com/feed/' },
  { id: 'outside', name: 'Outside',             tag: 'Lifestyle', url: 'https://www.outsideonline.com/feed/' },
  { id: 'sd-fit',  name: 'ScienceDaily',        tag: 'Research',  url: 'https://www.sciencedaily.com/rss/health_medicine/fitness.xml' },
  { id: 'sd-nut',  name: 'ScienceDaily',        tag: 'Nutrition', url: 'https://www.sciencedaily.com/rss/health_medicine/nutrition.xml' },
];

const FEED_TIMEOUT_MS = 8000;
const MAX_PER_FEED = 8;      // keeps one high-volume feed from swamping the page
const MAX_ITEMS = 48;
const SUMMARY_CHARS = 190;

/* The CDN serves this; the function itself runs a couple of times an hour
   however much traffic arrives. stale-while-revalidate means a visitor never
   waits on a refetch. */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Feed values arrive as strings, as CDATA objects, or as attributed nodes. */
function text(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return text(value['#text'] ?? value['@_href'] ?? '');
  return '';
}

/**
 * Feeds encode punctuation numerically - &#8217; for a curly apostrophe is
 * everywhere in WordPress titles - so a handful of named entities is not
 * enough. Decoded after tags are stripped, with &amp; last so an already
 * decoded string is not decoded twice.
 */
function fromCode(code) {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCode(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:rsquo|lsquo|apos|sbquo);/gi, "'")
    .replace(/&(?:rdquo|ldquo|quot|bdquo);/gi, '"')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripHtml(html) {
  return decodeEntities(text(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > n * 0.6 ? lastSpace : n).trim()}…`;
}

/** Atom links are attributed nodes; RSS links are plain strings. */
function linkOf(entry) {
  const direct = text(entry.link);
  if (direct && /^https?:/i.test(direct)) return direct;
  for (const l of asArray(entry.link)) {
    const href = l && l['@_href'];
    if (href && (!l['@_rel'] || l['@_rel'] === 'alternate')) return href;
  }
  return text(entry.guid) && /^https?:/i.test(text(entry.guid)) ? text(entry.guid) : '';
}

function dateOf(entry) {
  const raw =
    text(entry.pubDate) || text(entry.published) || text(entry.updated) || text(entry['dc:date']);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseFeed(xml, feed) {
  const doc = parser.parse(xml);
  // RSS 2.0 nests items under rss > channel; Atom puts entries on feed.
  const entries = doc?.rss?.channel
    ? asArray(doc.rss.channel.item)
    : doc?.feed
    ? asArray(doc.feed.entry)
    : asArray(doc?.['rdf:RDF']?.item);

  return entries
    .map((entry) => {
      const url = linkOf(entry);
      const title = stripHtml(entry.title);
      if (!url || !title) return null;
      return {
        id: `${feed.id}:${url}`,
        title,
        url,
        source: feed.name,
        tag: feed.tag,
        publishedAt: dateOf(entry),
        summary: truncate(
          stripHtml(entry.description ?? entry.summary ?? entry['content:encoded'] ?? entry.content),
          SUMMARY_CHARS
        ),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PER_FEED);
}

async function loadFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: {
        'User-Agent': 'IronIndexBot/1.0 (+https://www.ironindex.fit)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) return { feed, items: [], error: `HTTP ${res.status}` };
    return { feed, items: parseFeed(await res.text(), feed), error: null };
  } catch (err) {
    return { feed, items: [], error: err.name === 'TimeoutError' ? 'timed out' : err.message };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }

  // One slow publisher must not take the whole page down.
  const results = await Promise.all(FEEDS.map(loadFeed));

  const seen = new Set();
  const items = results
    .flatMap((r) => r.items)
    .filter((item) => {
      const key = item.url.split('?')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.localeCompare(a.publishedAt);
    })
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    return res.status(502).json({ error: 'No feed could be reached.' });
  }

  res.setHeader('Cache-Control', CACHE_CONTROL);
  return res.status(200).json({
    fetchedAt: new Date().toISOString(),
    items,
    sources: results.map((r) => ({
      name: r.feed.name,
      tag: r.feed.tag,
      ok: !r.error,
      error: r.error,
      count: r.items.length,
    })),
  });
};
