import { useCallback, useEffect, useMemo, useState } from 'react';
import StateBlock from './StateBlock';
import './NewsFeed.css';

const ALL = 'all';

function relativeDay(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const NewsFeed = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [tag, setTag] = useState(ALL);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/news', { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          throw new Error(
            'The feed only runs on the deployed site, not on the local dev server.'
          );
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `The feed returned ${res.status}.`);
        return data;
      })
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => controller.abort();
  }, []);

  const tags = useMemo(() => {
    if (!state.data) return [];
    return [...new Set(state.data.items.map((i) => i.tag))].sort();
  }, [state.data]);

  const visible = useMemo(() => {
    if (!state.data) return [];
    return tag === ALL ? state.data.items : state.data.items.filter((i) => i.tag === tag);
  }, [state.data, tag]);

  const pick = useCallback((t) => setTag(t), []);

  if (state.status === 'error') {
    return (
      <StateBlock tone="alert" code="Error 02-A" title="Wire down">
        {state.error}
      </StateBlock>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="news">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="news__row news__row--ghost skeleton" key={`ghost-${i}`} />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="news__filters" role="group" aria-label="Filter by topic">
        <button
          type="button"
          className={`news__chip${tag === ALL ? ' is-on' : ''}`}
          aria-pressed={tag === ALL}
          onClick={() => pick(ALL)}
        >
          All <span>{state.data.items.length}</span>
        </button>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className={`news__chip${tag === t ? ' is-on' : ''}`}
            aria-pressed={tag === t}
            onClick={() => pick(t)}
          >
            {t} <span>{state.data.items.filter((i) => i.tag === t).length}</span>
          </button>
        ))}
      </div>

      <ol className="news">
        {visible.map((item, i) => (
          <li className="news__row" key={item.id}>
            <span className="news__num">{String(i + 1).padStart(2, '0')}</span>
            <div className="news__body">
              <p className="news__meta">
                <span className="news__source">{item.source}</span>
                <span className="news__tag">{item.tag}</span>
                <time dateTime={item.publishedAt || undefined}>
                  {relativeDay(item.publishedAt)}
                </time>
              </p>
              <h3 className="news__title">
                <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                  {item.title}
                  <span className="news__out" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </h3>
              {item.summary && <p className="news__summary">{item.summary}</p>}
            </div>
          </li>
        ))}
      </ol>

      <p className="news__foot">
        Headlines and publishers' own summaries, linked to the source. Updated
        hourly. Last pulled {relativeDay(state.data.fetchedAt).toLowerCase()}.
      </p>
    </>
  );
};

export default NewsFeed;
