"use client";

import { useEffect, useState } from "react";

export interface NewsArticle {
  title: string;
  link: string;
  snippet: string;
  pubDate: string;
  image: string | null;
}

interface NewsWidgetProps {
  topic: string;
  expandedIndex: number | null; // Controlled by JarvisOrb via voice
  aiText?: string; // The AI's response text to type out
  onArticlesLoaded: (articles: NewsArticle[]) => void;
  onExpand: (index: number | null) => void;
}

export default function NewsWidget({ topic, expandedIndex, aiText, onArticlesLoaded, onExpand }: NewsWidgetProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Typewriter effect state
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (expandedIndex !== null && aiText) {
      let i = 0;
      setDisplayedText("");
      const interval = setInterval(() => {
        setDisplayedText(aiText.substring(0, i));
        i++;
        if (i > aiText.length) clearInterval(interval);
      }, 30); // 30ms per character typing speed
      return () => clearInterval(interval);
    }
  }, [expandedIndex, aiText]);

  useEffect(() => {
    let active = true;
    const fetchNews = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/news?topic=${encodeURIComponent(topic)}`);
        const data = await res.json();
        if (active) {
          if (data.success) {
            setArticles(data.articles);
            onArticlesLoaded(data.articles);
          } else {
            setError(data.error || "Failed to load news.");
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || "Network error fetching news.");
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchNews();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  if (loading) {
    return (
      <div className="holographic-news-container center-content">
        <div className="news-loader">
          <div className="spinner"></div>
          <p>SCANNING GLOBAL NETWORKS FOR '{topic.toUpperCase()}'...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="holographic-news-container center-content">
        <p className="news-error">ERR: {error}</p>
      </div>
    );
  }

  // Expanded View
  if (expandedIndex !== null && articles[expandedIndex]) {
    const article = articles[expandedIndex];
    return (
      <div className="holographic-news-container expanded center-content" style={{ padding: '3rem' }}>
        <button className="close-btn" onClick={() => onExpand(null)}>✕</button>
        <div className="expanded-content" style={{ textAlign: 'center', width: '100%', maxWidth: '900px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {article.image && (
            <img 
              src={article.image} 
              alt="Article Thumbnail" 
              className="expanded-img" 
              style={{ width: '100%', maxHeight: '50vh', objectFit: 'cover', borderRadius: '20px', marginBottom: '2rem', boxShadow: '0 0 30px hsla(var(--theme-h), 100%, 50%, 0.3)' }} 
            />
          )}
          <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--hud-base)', textShadow: '0 0 15px hsla(var(--theme-h), 100%, 50%, 0.5)' }}>
            {article.title}
          </h2>
          <div className="snippet" style={{ fontSize: '1.2rem', lineHeight: 1.6, textAlign: 'left', width: '100%', background: 'rgba(0,0,0,0.4)', padding: '2rem', borderRadius: '12px', border: '1px solid hsla(var(--theme-h), 100%, 50%, 0.2)', minHeight: '150px' }}>
            {displayedText}
            <span className="cursor-blink">_</span>
          </div>
          <a href={article.link} target="_blank" rel="noreferrer" className="read-more-btn" style={{ marginTop: '2rem' }}>
            ACCESS FULL DATALINK
          </a>
        </div>
      </div>
    );
  }

  // Grid View
  return (
    <div className="holographic-news-container grid-view">
      <div className="news-header">
        <h3>LIVE INTEL: {topic.toUpperCase()}</h3>
      </div>
      {articles.length === 0 ? (
        <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--hud-hot)', letterSpacing: '0.2em' }}>
           NO DATA FOUND FOR THIS QUERY.
        </div>
      ) : (
        <div className="news-grid">
          {articles.map((article, i) => (
            <div key={i} className="news-card" onClick={() => onExpand(i)}>
              <div className="news-card-image">
                {article.image ? (
                  <img src={article.image} alt="thumbnail" />
                ) : (
                  <div className="placeholder-img">NO IMAGE DATA</div>
                )}
              </div>
              <div className="news-card-content">
                <h4>{article.title}</h4>
                <span className="card-number">0{i + 1}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
