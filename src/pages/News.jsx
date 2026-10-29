import { useEffect } from 'react';
import NewsFeed from '../components/NewsFeed';
import RouteLink from '../components/RouteLink';

const TITLE = 'Dispatch — Iron Index';

export default function News() {
  useEffect(() => {
    const previous = document.title;
    document.title = TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main className="page">
      <section className="build shell">
        <div className="chapter">
          <span className="chapter__num">01 /</span>
          <h1 className="chapter__title">Dispatch</h1>
          <p className="chapter__note">
            Training, nutrition, health
            <br />
            Updated through the day
          </p>
        </div>

        <p className="build__lede">
          Headlines from people who read the papers, not the press releases.
          Research reviewers and clinicians first, general health and lifestyle
          after. Everything links out to the publisher.
        </p>

        <NewsFeed />

        <p className="build__back">
          <RouteLink to="/#target">← Back to the archive</RouteLink>
        </p>
      </section>
    </main>
  );
}
