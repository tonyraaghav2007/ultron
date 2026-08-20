"use client";

import { useState, useRef, useCallback } from "react";

interface BrowserWidgetProps {
  url: string;
}

interface FollowUpMsg {
  role: 'user' | 'jarvis';
  text: string;
}

export default function BrowserWidget({ url }: BrowserWidgetProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Summary panel state
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryPhase, setSummaryPhase] = useState('');
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryError, setSummaryError] = useState('');

  // Product expansion states
  const [reviewData, setReviewData] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  // Follow-up chat
  const [chatMessages, setChatMessages] = useState<FollowUpMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Send to phone
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  // Expanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['keyPoints', 'specs', 'features']));

  const formattedUrl = url.startsWith("http") ? url : `https://${url}`;

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // ============ SUMMARIZE ============
  const handleSummarize = useCallback(async () => {
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryError('');
    setSummaryData(null);
    setReviewData(null);
    setComparisonData(null);
    setChatMessages([]);

    try {
      setSummaryPhase('Analyzing page structure...');
      await new Promise(r => setTimeout(r, 300));

      setSummaryPhase('Extracting content...');
      const res = await fetch('/api/browser/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formattedUrl }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Summarization failed');
      }

      setSummaryPhase('Synthesizing...');
      const data = await res.json();
      setSummaryData(data);
      setSummaryPhase('');
    } catch (err: any) {
      setSummaryError(err.message);
      setSummaryPhase('');
    } finally {
      setSummaryLoading(false);
    }
  }, [formattedUrl]);

  // ============ RESEARCH REVIEWS ============
  const handleResearchReviews = useCallback(async () => {
    setReviewLoading(true);
    try {
      const res = await fetch('/api/browser/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'research_reviews' }),
      });
      const data = await res.json();
      setReviewData(data.data);
    } catch { }
    setReviewLoading(false);
  }, []);

  // ============ FIND ALTERNATIVES ============
  const handleFindAlternatives = useCallback(async () => {
    setComparisonLoading(true);
    try {
      const res = await fetch('/api/browser/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'find_alternatives' }),
      });
      const data = await res.json();
      setComparisonData(data.data);
    } catch { }
    setComparisonLoading(false);
  }, []);

  // ============ FOLLOW-UP CHAT ============
  const handleChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const question = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: question }]);
    setChatLoading(true);

    try {
      const res = await fetch('/api/browser/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'followup', question }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'jarvis', text: data.answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'jarvis', text: 'Failed to process your question.' }]);
    }
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [chatInput]);

  // ============ SEND TO PHONE ============
  const handleSendToPhone = useCallback(async () => {
    setSendStatus('Sending...');
    try {
      const res = await fetch('/api/browser/send-to-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: summaryData?.data?.title || document.title || formattedUrl,
          url: formattedUrl,
          description: summaryData?.data?.shortSummary || '',
        }),
      });
      const data = await res.json();
      setSendStatus(data.success ? 'Sent ✓' : 'Failed');
    } catch {
      setSendStatus('Failed');
    }
    setTimeout(() => setSendStatus(null), 3000);
  }, [formattedUrl, summaryData]);

  // ============ RENDER ARTICLE SUMMARY ============
  const renderArticleSummary = (data: any) => (
    <div className="bi-summary-content">
      {data.featuredImage && (
        <div className="bi-featured-image">
          <img src={data.featuredImage.src} alt={data.featuredImage.alt} onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
      )}

      <div className="bi-section">
        <p className="bi-short-summary">{data.shortSummary}</p>
      </div>

      <div className="bi-section">
        <div className="bi-section-header" onClick={() => toggleSection('keyPoints')}>
          <span>KEY POINTS</span>
          <span className="bi-chevron">{expandedSections.has('keyPoints') ? '▾' : '▸'}</span>
        </div>
        {expandedSections.has('keyPoints') && (
          <ul className="bi-list">{data.keyPoints?.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
        )}
      </div>

      {data.importantDetails?.length > 0 && (
        <div className="bi-section">
          <div className="bi-section-header" onClick={() => toggleSection('details')}>
            <span>IMPORTANT DETAILS</span>
            <span className="bi-chevron">{expandedSections.has('details') ? '▾' : '▸'}</span>
          </div>
          {expandedSections.has('details') && (
            <ul className="bi-list">{data.importantDetails.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>
          )}
        </div>
      )}

      {data.whyItMatters && (
        <div className="bi-section">
          <div className="bi-section-label">WHY IT MATTERS</div>
          <p className="bi-text">{data.whyItMatters}</p>
        </div>
      )}

      {data.keyNumbers?.length > 0 && (
        <div className="bi-section">
          <div className="bi-section-label">KEY NUMBERS</div>
          <div className="bi-tags">{data.keyNumbers.map((n: string, i: number) => <span key={i} className="bi-tag">{n}</span>)}</div>
        </div>
      )}

      {data.importantQuotes?.length > 0 && (
        <div className="bi-section">
          <div className="bi-section-label">NOTABLE QUOTES</div>
          {data.importantQuotes.map((q: string, i: number) => <blockquote key={i} className="bi-quote">"{q}"</blockquote>)}
        </div>
      )}

      <div className="bi-section bi-takeaway">
        <div className="bi-section-label">JARVIS TAKEAWAY</div>
        <p className="bi-text">{data.jarvisTakeaway}</p>
      </div>
    </div>
  );

  // ============ RENDER PRODUCT SUMMARY ============
  const renderProductSummary = (data: any) => (
    <div className="bi-summary-content">
      {data.featuredImage && (
        <div className="bi-featured-image">
          <img src={data.featuredImage.src} alt={data.featuredImage.alt} onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
      )}

      <div className="bi-product-header">
        <div className="bi-product-name">{data.productName}</div>
        {data.model && data.model !== data.productName && <div className="bi-product-model">{data.model}</div>}
        <div className="bi-product-price">
          {data.discountedPrice && data.discountedPrice !== data.price ? (
            <><span className="bi-price-discount">{data.discountedPrice}</span> <span className="bi-price-original">{data.price}</span></>
          ) : (
            <span className="bi-price-discount">{data.price}</span>
          )}
        </div>
      </div>

      <div className="bi-section">
        <div className="bi-section-header" onClick={() => toggleSection('specs')}>
          <span>SPECIFICATIONS</span>
          <span className="bi-chevron">{expandedSections.has('specs') ? '▾' : '▸'}</span>
        </div>
        {expandedSections.has('specs') && data.specs && (
          <div className="bi-specs-grid">
            {Object.entries(data.specs).map(([key, val]: [string, any]) => (
              <div key={key} className="bi-spec-item">
                <span className="bi-spec-key">{key}</span>
                <span className="bi-spec-val">{val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bi-section">
        <div className="bi-section-header" onClick={() => toggleSection('features')}>
          <span>KEY FEATURES</span>
          <span className="bi-chevron">{expandedSections.has('features') ? '▾' : '▸'}</span>
        </div>
        {expandedSections.has('features') && (
          <ul className="bi-list">{data.features?.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
        )}
      </div>

      <div className="bi-section bi-two-col">
        <div>
          <div className="bi-section-label bi-green">WHAT JARVIS LIKES</div>
          <ul className="bi-list bi-green-list">{data.whatJarvisLikes?.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
        </div>
        <div>
          <div className="bi-section-label bi-orange">POTENTIAL PROBLEMS</div>
          <ul className="bi-list bi-orange-list">{data.potentialProblems?.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
        </div>
      </div>

      <div className="bi-section">
        <div className="bi-section-label">WHO SHOULD BUY</div>
        <p className="bi-text">{data.whoShouldBuy}</p>
        <div className="bi-section-label" style={{ marginTop: '8px' }}>WHO SHOULD NOT</div>
        <p className="bi-text">{data.whoShouldNot}</p>
      </div>

      <div className="bi-section bi-takeaway">
        <div className="bi-section-label">FINAL VERDICT</div>
        <p className="bi-text">{data.finalVerdict}</p>
      </div>

      <div className="bi-section">
        <div className="bi-meta-row">
          <span>Rating: {data.rating}</span>
          <span>Reviews: {data.reviewCount}</span>
          <span>Warranty: {data.warranty}</span>
          <span>{data.availability}</span>
        </div>
      </div>

      {/* Opt-in: Research Reviews */}
      <div className="bi-expansion-actions">
        <button
          className="bi-expand-btn"
          onClick={handleResearchReviews}
          disabled={reviewLoading || !!reviewData}
        >
          {reviewLoading ? 'Researching...' : reviewData ? 'Reviews Loaded ✓' : '🔍 Research Real User Reviews'}
        </button>
        <button
          className="bi-expand-btn"
          onClick={handleFindAlternatives}
          disabled={comparisonLoading || !!comparisonData}
        >
          {comparisonLoading ? 'Searching...' : comparisonData ? 'Alternatives Loaded ✓' : '⚡ Find Alternatives'}
        </button>
      </div>

      {/* Review research results */}
      {reviewData && (
        <div className="bi-section bi-review-results">
          <div className="bi-section-label">USER EXPERIENCE ({reviewData.confidence?.toUpperCase()} CONFIDENCE)</div>
          <p className="bi-text bi-small">{reviewData.sentimentSummary}</p>
          {reviewData.strengths?.length > 0 && (
            <div>
              <div className="bi-section-label bi-green" style={{ fontSize: '10px' }}>STRENGTHS</div>
              <ul className="bi-list bi-green-list">{reviewData.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {reviewData.recurringComplaints?.length > 0 && (
            <div>
              <div className="bi-section-label bi-orange" style={{ fontSize: '10px' }}>RECURRING COMPLAINTS</div>
              <ul className="bi-list bi-orange-list">{reviewData.recurringComplaints.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          <div className="bi-meta-row">
            <span>Sources checked: {reviewData.sourcesChecked}</span>
            <span>Relevant opinions: {reviewData.relevantComments}</span>
          </div>
        </div>
      )}

      {/* Comparison results */}
      {comparisonData && comparisonData.alternatives?.length > 0 && (
        <div className="bi-section bi-comparison">
          <div className="bi-section-label">ALTERNATIVES</div>
          <div className="bi-comparison-grid">
            {comparisonData.alternatives.map((alt: any, i: number) => (
              <div key={i} className="bi-alt-card">
                <div className="bi-alt-name">{alt.name}</div>
                <div className="bi-alt-price">{alt.price}</div>
                <div className="bi-alt-diff">{alt.keyDifference}</div>
              </div>
            ))}
          </div>
          <p className="bi-text bi-small" style={{ marginTop: '8px' }}>{comparisonData.comparisonNotes}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="holographic-news-container center-content" style={{ padding: 0, position: 'relative' }}>
      {/* Loading spinner */}
      {loading && !error && (
        <div className="news-loader" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 5 }}>
          <div className="spinner"></div>
          <p>ESTABLISHING SECURE DATALINK TO {formattedUrl}...</p>
        </div>
      )}

      {error && (
        <div className="news-error" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10 }}>
          ERR: DATALINK REFUSED. THE TARGET DOMAIN IS BLOCKING HOLOGRAPHIC PROJECTION (X-Frame-Options DENY).
        </div>
      )}

      {/* Top-right action buttons */}
      {!loading && !error && (
        <div className="bi-action-bar">
          <button className="bi-action-btn" onClick={handleSendToPhone} disabled={!!sendStatus}>
            {sendStatus || '📱 Send to Phone'}
          </button>
          <button className="bi-action-btn bi-action-primary" onClick={handleSummarize} disabled={summaryLoading}>
            {summaryLoading ? '⏳ Analyzing...' : '🧠 Summarize'}
          </button>
        </div>
      )}

      {/* Iframe */}
      <div style={{
        width: summaryOpen ? '60%' : '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        borderRadius: '20px',
        transition: 'width 0.3s ease',
      }}>
        <iframe
          src={formattedUrl}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '150%',
            height: '150%',
            transform: 'scale(0.666667)',
            transformOrigin: 'top left',
            border: 'none',
            opacity: loading ? 0 : 1,
            transition: 'opacity 0.5s ease',
            zIndex: 2,
            background: '#fff'
          }}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="Holographic Browser"
        />
      </div>

      {/* Summary Panel */}
      {summaryOpen && (
        <div className="bi-panel">
          <div className="bi-panel-header">
            <span className="bi-panel-title">JARVIS INTELLIGENCE</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {summaryData && (
                <span className="bi-page-type-badge">{summaryData.pageType?.toUpperCase()}</span>
              )}
              <button className="bi-close-btn" onClick={() => setSummaryOpen(false)}>✕</button>
            </div>
          </div>

          <div className="bi-panel-body">
            {/* Loading phases */}
            {summaryLoading && (
              <div className="bi-loading">
                <div className="bi-loading-spinner"></div>
                <div className="bi-loading-phase">{summaryPhase}</div>
              </div>
            )}

            {/* Error */}
            {summaryError && (
              <div className="bi-error">{summaryError}</div>
            )}

            {/* Summary content */}
            {summaryData && !summaryLoading && (
              <>
                {summaryData.type === 'product'
                  ? renderProductSummary(summaryData.data)
                  : renderArticleSummary(summaryData.data)
                }

                {/* Follow-up chat */}
                <div className="bi-chat-section">
                  <div className="bi-section-label">ASK JARVIS</div>
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`bi-chat-msg ${msg.role}`}>
                      <span className="bi-chat-role">{msg.role === 'user' ? 'YOU' : 'JARVIS'}</span>
                      <span className="bi-chat-text">{msg.text}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                  <div className="bi-chat-input-row">
                    <input
                      type="text"
                      className="bi-chat-input"
                      placeholder="Ask a follow-up question..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleChat(); }}
                      disabled={chatLoading}
                    />
                    <button className="bi-chat-send" onClick={handleChat} disabled={chatLoading || !chatInput.trim()}>
                      {chatLoading ? '...' : '→'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
