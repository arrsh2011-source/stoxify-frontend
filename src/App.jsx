import { useState, useEffect, useCallback, useRef } from "react";

const BACKEND = "https://stoxify-production.up.railway.app";
const SOURCES = ['Reuters','CNBC','Bloomberg','ET Markets','Moneycontrol','WSJ','Livemint'];

const TAG_META = {
  earnings:{cls:'te',label:'Earnings'},
  tech:{cls:'tt',label:'Tech'},
  fed:{cls:'tf',label:'Fed'},
  india:{cls:'ti',label:'India'},
  ipo:{cls:'tip',label:'IPO'},
  general:{cls:'tg',label:'Markets'},
};

// ── Ticker auto-conversion — natural names to API symbols ────
const TICKER_ALIASES = {
  // Indian indices
  'NIFTY':'^NSEI','NIFTY50':'^NSEI','NIFTY 50':'^NSEI',
  'SENSEX':'^BSESN','BSE':'^BSESN',
  'BANKNIFTY':'^NSEBANK','BANK NIFTY':'^NSEBANK',
  // Indian stocks — auto add .NS
  'RELIANCE':'RELIANCE.NS','TCS':'TCS.NS','INFY':'INFY.NS',
  'INFOSYS':'INFY.NS','HDFCBANK':'HDFCBANK.NS','ICICIBANK':'ICICIBANK.NS',
  'WIPRO':'WIPRO.NS','BAJFINANCE':'BAJFINANCE.NS','SBIN':'SBIN.NS',
  'ADANIENT':'ADANIENT.NS','TATAMOTORS':'TATAMOTORS.NS','MARUTI':'MARUTI.NS',
  'SUNPHARMA':'SUNPHARMA.NS','AXISBANK':'AXISBANK.NS','KOTAKBANK':'KOTAKBANK.NS',
  'HCLTECH':'HCLTECH.NS','TECHM':'TECHM.NS','TITAN':'TITAN.NS',
  'NESTLEIND':'NESTLEIND.NS','LTIM':'LTIM.NS','ONGC':'ONGC.NS',
  'NTPC':'NTPC.NS','POWERGRID':'POWERGRID.NS','ASIANPAINT':'ASIANPAINT.NS',
  'ULTRACEMCO':'ULTRACEMCO.NS','HINDUNILVR':'HINDUNILVR.NS',
  // US indices
  'SP500':'^GSPC','S&P500':'^GSPC','S&P 500':'^GSPC',
  'DOW':'^DJI','DOWJONES':'^DJI','DOW JONES':'^DJI',
  'NASDAQ':'^IXIC',
};
function resolveTicker(input) {
  const upper = input.trim().toUpperCase().replace(/\s+/g,' ');
  return TICKER_ALIASES[upper] || upper;
}

const FALLBACK_TICKERS = [
  {sym:'NIFTY',price:'24,853',chg:'+0.86%',up:true},
  {sym:'SENSEX',price:'81,752',chg:'+0.79%',up:true},
  {sym:'NVDA',price:'1,148',chg:'+2.14%',up:true},
  {sym:'AAPL',price:'192.35',chg:'+1.24%',up:true},
  {sym:'TSLA',price:'178.22',chg:'-0.95%',up:false},
  {sym:'RELIANCE',price:'2,954',chg:'+1.12%',up:true},
  {sym:'TCS',price:'3,812',chg:'+0.68%',up:true},
];

// ─────────────────────────────────────────────────────────────
// Sentiment indicator — keyword-based, V1
// Not backtested. Not a buy/sell recommendation.
// ─────────────────────────────────────────────────────────────
function calcSentiment(headline, summary, source, tag) {
  const text = (headline + ' ' + (summary||'')).toLowerCase();
  const bull = ['surge','rally','gain','rise','jump','beat','record','high','growth','strong','profit','upgrade','positive','boost','breakout','momentum'];
  const bear = ['fall','drop','decline','loss','miss','low','weak','downgrade','negative','cut','crash','plunge','warn','risk','concern'];
  let score = 50;
  bull.forEach(w => { if(text.includes(w)) score += 5; });
  bear.forEach(w => { if(text.includes(w)) score -= 5; });
  score = Math.max(5, Math.min(95, score));
  const label = score > 60 ? 'Positive' : score < 40 ? 'Negative' : 'Mixed';
  const color = score > 60 ? '#22c55e' : score < 40 ? '#ef4444' : '#f59e0b';
  return { score, label, color };
}

// ─────────────────────────────────────────────────────────────
// Article analysis — structured, rule-based, honest
// ─────────────────────────────────────────────────────────────
function getArticleAnalysis(headline, desc, tag, sentimentLabel) {
  const h = (headline + ' ' + (desc||'')).toLowerCase();

  const DATA = {
    earnings: {
      whatHappened: {
        Positive: 'A company reported financial results that beat analyst expectations — meaning the business performed better than the market predicted.',
        Negative: 'A company reported financial results that missed analyst expectations — meaning the business underperformed what the market had priced in.',
        Mixed:    'A company reported financial results roughly in line with expectations — neither a clear beat nor a miss.',
      },
      whyMarketsCare: 'Earnings are the most watched event in markets. They reveal whether a business is actually growing. Stock prices often move 5–15% on the day results are released.',
      whoIsAffected: {
        Positive: 'Shareholders of the company benefit immediately. Sector peers often rally in sympathy. Suppliers and partners of the company may also see positive movement.',
        Negative: 'Shareholders face losses. Sector peers often fall on fears the weakness is industry-wide. Competitors may benefit if customers switch.',
        Mixed:    'Shareholders face uncertainty. The market will focus heavily on what management says about the next quarter.',
      },
      bullCase: {
        Positive: 'If management raised full-year guidance, the stock could continue rising as analysts upgrade their models. Strong revenue growth is the most durable positive signal.',
        Negative: 'If management explains the miss as one-off (weather, supply chain, currency), the stock may recover quickly. Watch if insiders buy shares in the weeks after.',
        Mixed:    'If guidance for next quarter is raised, markets may react positively despite the in-line result. Cost cuts improving margins is a secondary positive.',
      },
      bearCase: {
        Positive: 'Beats that come purely from cost cutting rather than revenue growth are weak. If the stock was already expensive before results, "buy the rumour, sell the news" selling can happen.',
        Negative: 'If management lowered forward guidance, the stock may fall further even after the initial reaction. Multiple consecutive misses signal a broken business model.',
        Mixed:    'In-line results with no guidance raise often get sold. If the broader market is already weak, in-line results give sellers an excuse.',
      },
      watchNext: 'The earnings call transcript — specifically any change in full-year guidance and what management says about demand. Also watch the stock price 2–3 days after, when initial reaction settles.',
    },
    fed: {
      whatHappened: {
        Positive: 'The US Federal Reserve or RBI made a decision or statement that markets read as supportive — either cutting rates, signalling future cuts, or easing policy.',
        Negative: 'The US Federal Reserve or RBI made a decision or statement that markets read as restrictive — either hiking rates, signalling fewer cuts, or tightening policy.',
        Mixed:    'The central bank held rates unchanged and gave mixed signals — neither clearly dovish nor hawkish.',
      },
      whyMarketsCare: 'Interest rates are the price of money. When rates fall, borrowing is cheaper — companies invest more, consumers spend more, and stock valuations rise. When rates rise, the opposite happens. Central bank decisions affect every asset class simultaneously.',
      whoIsAffected: {
        Positive: 'Banks earn less on deposits but lend more. Real estate becomes more affordable. High-growth tech companies benefit most since their future earnings are worth more when discounted at lower rates. Indian markets benefit as foreign money flows in seeking returns.',
        Negative: 'Highly indebted companies face higher interest costs. Real estate slows. Growth stocks fall harder than value stocks. EMIs on loans rise for consumers.',
        Mixed:    'Markets hate uncertainty. A hold with mixed language often causes more volatility than a clear cut or hike.',
      },
      bullCase: {
        Positive: 'A rate cut cycle typically lasts 12–18 months and lifts most asset classes. Historically, the first rate cut of a cycle is followed by strong equity market returns over the next 12 months.',
        Negative: 'If inflation is falling faster than expected, the hike may be the last one. Markets often rally when they believe the hiking cycle is near its peak.',
        Mixed:    'If upcoming inflation data comes in lower, the next meeting could bring a cut. Patience is rewarded in a hold environment.',
      },
      bearCase: {
        Positive: 'Rate cuts signal the economy may be slowing. If cuts happen because of recession fears rather than controlled inflation, equity markets may not benefit.',
        Negative: 'If inflation proves sticky, further hikes are possible. Each additional hike increases recession risk. High-rate environments historically precede market corrections.',
        Mixed:    'Prolonged holds increase uncertainty and can suppress investment and hiring decisions.',
      },
      watchNext: 'The next inflation print (CPI data) and the following central bank meeting minutes. Also watch bond yields — they often signal what the market expects before the official decision.',
    },
    ipo: {
      whatHappened: {
        Positive: 'A company is listing or has listed on a stock exchange, with strong demand — high subscription rates or grey market premium suggesting investor enthusiasm.',
        Negative: 'A company IPO is seeing weak demand — low subscription rates or a falling grey market premium suggesting investor caution.',
        Mixed:    'An IPO is seeing moderate interest — subscribed but not overwhelmed, with uncertain listing day expectations.',
      },
      whyMarketsCare: 'IPOs are a signal of market health and investor risk appetite. When IPOs do well, it shows money is flowing into markets. When they fail, it often signals caution. IPOs also create new stocks that index funds and retail investors can own.',
      whoIsAffected: {
        Positive: 'Early investors and promoters see strong returns. Investment banks handling the issue earn fees. The broader market sees it as a positive sentiment signal.',
        Negative: 'Anchor investors and those who applied face mark-to-market losses. Companies planning future IPOs may delay. Market confidence takes a small hit.',
        Mixed:    'Moderate outcome — allottees face uncertainty about listing gains.',
      },
      bullCase: {
        Positive: 'Strong listing day performance often continues for 2–5 days as momentum buyers pile in. High-quality businesses with strong IPOs often become long-term compounders.',
        Negative: 'Weak IPOs sometimes become strong long-term buys once price resets to fair value. Look at the business fundamentals, not just the listing.',
        Mixed:    'If the company has strong fundamentals, a flat listing is a buying opportunity — you can enter without paying the IPO premium.',
      },
      bearCase: {
        Positive: 'First-week volatility is high. Many IPOs that list strong give back gains in weeks 2–4 as anchor lock-ups expire and early investors sell.',
        Negative: 'Weak IPOs can take months or years to recover. If the business model was questionable, no price decline makes it worth holding.',
        Mixed:    'Middling listings often drift lower before finding a floor. Patience is needed.',
      },
      watchNext: 'The lock-up expiry date when early investors can sell. Quarterly results for the first 2 quarters post-listing — these reveal whether the IPO story holds in practice.',
    },
    india: {
      whatHappened: {
        Positive: 'Indian markets moved higher, driven by positive domestic or global factors — FII buying, strong earnings, rupee stability, or positive macro data.',
        Negative: 'Indian markets fell, driven by FII selling, global risk-off, rupee weakness, or negative macro signals.',
        Mixed:    'Indian markets showed mixed movement — sector rotation or conflicting signals between domestic strength and global headwinds.',
      },
      whyMarketsCare: 'India is one of the largest and fastest-growing emerging markets. Nifty and Sensex movements affect millions of Indian investors, pension funds, and mutual fund holders. FII flows are a major driver — when foreign money comes in, markets rise; when it leaves, markets fall.',
      whoIsAffected: {
        Positive: 'Equity mutual fund investors, direct stock investors, and businesses looking to raise capital all benefit. A strong rupee helps import-heavy businesses.',
        Negative: 'Equity portfolios fall in value. Companies with dollar debt face higher repayment costs when rupee weakens. Import costs rise.',
        Mixed:    'Sector-specific impact — IT companies often benefit from global moves while domestic sectors follow local cues.',
      },
      bullCase: {
        Positive: 'Sustained FII buying over 5+ days often signals a structural re-rating of India. India long-term GDP growth story remains one of the strongest globally.',
        Negative: 'FII selling is often short-term. Domestic institutions (DIIs) typically buy on dips, providing a floor. India domestic consumption story is not broken by global events.',
        Mixed:    'Consolidation after a strong rally is healthy. Markets rarely go up in a straight line.',
      },
      bearCase: {
        Positive: 'Nifty at all-time highs is expensive relative to history. A global risk-off event could trigger sharp corrections even from strong momentum.',
        Negative: 'If FII selling continues for 10+ days, it can become self-reinforcing as stop-losses trigger. Rupee weakness adds to the pain.',
        Mixed:    'Mixed markets can precede larger directional moves — either way.',
      },
      watchNext: 'FII flow data released daily by NSE. India VIX (volatility index). Global cues from US markets overnight. RBI commentary and rupee movement.',
    },
    tech: {
      whatHappened: {
        Positive: 'A technology company or the broader tech sector showed strength — strong earnings, product announcement, AI adoption, or market share gain.',
        Negative: 'A technology company or the broader tech sector showed weakness — earnings miss, slowing growth, regulatory pressure, or valuation reset.',
        Mixed:    'The tech sector showed mixed signals — some companies performing well while others disappoint.',
      },
      whyMarketsCare: 'Technology is the largest sector in global markets by market cap. Moves in US tech (Apple, NVIDIA, Microsoft, Google) ripple across global markets. Indian IT companies like TCS, Infosys, and HCL Tech derive most revenue from US tech spending, so US tech health directly impacts Indian IT stocks.',
      whoIsAffected: {
        Positive: 'Tech shareholders and employees with ESOPs benefit. Indian IT companies benefit as US tech spending rises. Semiconductor and chip companies are often the first to benefit from AI demand.',
        Negative: 'Tech shareholders face losses. Indian IT companies may see deal delays if US clients cut budgets. Startup funding often dries up in tech downturns.',
        Mixed:    'Stock-picking matters more in mixed tech environments — individual company results diverge significantly.',
      },
      bullCase: {
        Positive: 'AI infrastructure spending is multi-year. NVIDIA, TSMC, and cloud companies (AWS, Azure, GCP) are in a structural upcycle. Strong US tech spending flows to Indian IT services companies.',
        Negative: 'Tech selloffs are often buying opportunities for quality companies. Valuations reset, creating better entry points for long-term investors.',
        Mixed:    'Mixed results create clearer separation between quality and hype — investors rotate to companies with real revenue growth.',
      },
      bearCase: {
        Positive: 'Tech valuations are high. Any disappointment in guidance can cause sharp reversals. AI hype may be pricing in too much too soon.',
        Negative: 'Rising interest rates compound tech weakness — high-valuation stocks are hurt most. If the US economy slows, enterprise IT budgets are cut quickly.',
        Mixed:    'Uncertainty in tech often keeps money on the sidelines, slowing the recovery.',
      },
      watchNext: 'NVIDIA earnings (quarterly bellwether for AI demand). US CPI data (affects rate expectations which drive tech valuations). Indian IT management commentary on deal pipelines.',
    },
    general: {
      whatHappened: {
        Positive: 'Positive news is moving markets — improved economic data, geopolitical progress, or broad risk-on sentiment.',
        Negative: 'Negative news is weighing on markets — economic concern, geopolitical tension, or broad risk-off sentiment.',
        Mixed:    'Markets are digesting mixed signals — no clear directional catalyst.',
      },
      whyMarketsCare: 'Markets are forward-looking — they price in expectations, not just current reality. Any new information that changes those expectations moves prices.',
      whoIsAffected: {
        Positive: 'Broadly positive for equity investors and businesses. Emerging markets like India benefit when global risk appetite improves.',
        Negative: 'Equity markets fall. Safe-haven assets like gold and government bonds often rise. Emerging markets tend to fall harder than developed markets in risk-off environments.',
        Mixed:    'Sector-specific impact depends on the nature of the news.',
      },
      bullCase: {
        Positive: 'Improving global sentiment combined with India domestic growth story creates a strong tailwind. Follow the money — sustained institutional buying over several days is the most reliable signal.',
        Negative: 'Corrections are healthy and normal. The best long-term returns often come from buying quality assets during broad market fear.',
        Mixed:    'Uncertainty resolves eventually. Investors with patience and diversified portfolios are least affected by mixed-signal periods.',
      },
      bearCase: {
        Positive: 'Euphoria can push markets above fair value. Momentum can reverse sharply when sentiment shifts.',
        Negative: 'Bad news can beget more bad news — forced selling by overleveraged investors amplifies moves.',
        Mixed:    'Prolonged uncertainty suppresses investment and hiring, which can eventually slow economic growth.',
      },
      watchNext: 'Global market closes overnight. VIX (fear index) direction. FII flow data. The next major data release (jobs report, CPI, earnings).',
    },
  };

  const d = DATA[tag] || DATA.general;
  return {
    whatHappened:   d.whatHappened[sentimentLabel]   || d.whatHappened.Mixed,
    whyMarketsCare: d.whyMarketsCare,
    whoIsAffected:  d.whoIsAffected[sentimentLabel]  || d.whoIsAffected.Mixed,
    bullCase:       d.bullCase[sentimentLabel]        || d.bullCase.Mixed,
    bearCase:       d.bearCase[sentimentLabel]        || d.bearCase.Mixed,
    watchNext:      d.watchNext,
  };
}

// ── Sentiment bar — honest label ──────────────────────────────
function SentimentBar({ score, label, color }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{flex:1,height:2,background:'rgba(255,255,255,.1)',borderRadius:1}}>
        <div style={{height:'100%',width:score+'%',background:color,borderRadius:1,transition:'width .6s ease'}}/>
      </div>
      <span style={{fontSize:8,color,fontFamily:'monospace',fontWeight:700,letterSpacing:'0.08em',minWidth:52}}>{label.toUpperCase()}</span>
    </div>
  );
}

function agoLabel(i){
  const m=[4,12,25,40,58,80,105,140][i]||140;
  return m<60?m+'m ago':Math.floor(m/60)+'h '+(m%60?m%60+'m ':'')+' ago';
}

function Tag({cls,label}){
  const c={
    te:{bg:'rgba(34,197,94,.12)',tx:'#4ade80'},
    tt:{bg:'rgba(59,130,246,.14)',tx:'#60a5fa'},
    tf:{bg:'rgba(245,158,11,.12)',tx:'#fbbf24'},
    ti:{bg:'rgba(249,115,22,.12)',tx:'#fb923c'},
    tip:{bg:'rgba(168,85,247,.12)',tx:'#c084fc'},
    tg:{bg:'rgba(255,255,255,.1)',tx:'#666'},
  }[cls]||{bg:'rgba(255,255,255,.1)',tx:'#666'};
  return <span style={{fontSize:9,padding:'2px 7px',borderRadius:3,fontFamily:'monospace',fontWeight:600,background:c.bg,color:c.tx,letterSpacing:'0.06em'}}>{label}</span>;
}

function Skel({w,h,mb=0}){
  return <div style={{height:h,width:w,marginBottom:mb,borderRadius:3,background:'linear-gradient(90deg,#12121a 25%,#1a1a24 50%,#12121a 75%)',backgroundSize:'200% 100%',animation:'shimmer 1.4s infinite'}}/>;
}

// ── Article modal — bottom sheet, Bloomberg-style structure ──
function ArticleModal({article,onClose,dark=true}){
  const {score,label,color}=calcSentiment(article.title,article.desc,article.source,article.tag);
  const analysis=getArticleAnalysis(article.title,article.desc,article.tag,label);

  const Section=({title,children,accent})=>(
    <div style={{marginBottom:20}}>
      <div style={{fontSize:9,color:accent||'#2a2a2a',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
        {accent&&<span style={{width:3,height:3,borderRadius:'50%',background:accent,display:'inline-block'}}/>}
        {title}
      </div>
      <p style={{fontSize:13,color:'#888',lineHeight:1.8,margin:0,fontFamily:'Georgia,serif'}}>{children}</p>
    </div>
  );

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.88)',zIndex:500,display:'flex',alignItems:'flex-end',justifyContent:'center',backdropFilter:'blur(6px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:dark?'#0e0e16':'#ffffff',border:`1px solid ${dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.1)'}`,borderRadius:'14px 14px 0 0',padding:'20px 20px 40px',width:'100%',maxWidth:640,maxHeight:'90vh',overflowY:'auto',position:'relative'}}>

        <div style={{width:32,height:3,background:'rgba(255,255,255,.08)',borderRadius:2,margin:'0 auto 20px'}}/>

        {/* source + tag + time */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          <span style={{fontSize:10,color:'#555',letterSpacing:'.08em',textTransform:'uppercase',fontFamily:'monospace'}}>{article.source}</span>
          <Tag cls={article.tagMeta.cls} label={article.tagMeta.label}/>
          <span style={{fontSize:9,color:'#222',fontFamily:'monospace',marginLeft:'auto'}}>{article.time}</span>
        </div>

        {/* headline */}
        <h2 style={{fontFamily:'Georgia,serif',fontSize:'clamp(16px,4vw,21px)',fontWeight:700,color:'#f5f5f5',lineHeight:1.32,marginBottom:12}}>{article.title}</h2>

        {/* original summary */}
        {article.desc&&<p style={{fontSize:13,color:'#999',lineHeight:1.8,fontFamily:'Georgia,serif',marginBottom:16,paddingBottom:16,borderBottom:'1px solid rgba(255,255,255,.09)'}}>{article.desc}</p>}

        {/* read original link */}
        {article.url&&(
          <a href={article.url} target="_blank" rel="noreferrer"
            style={{display:'inline-flex',alignItems:'center',gap:5,marginBottom:20,fontSize:10,color:'#888',fontFamily:'monospace',textDecoration:'none',border:'1px solid rgba(255,255,255,.1)',borderRadius:5,padding:'5px 10px',transition:'border-color .15s'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.16)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.1)'}>
            Read original article
          </a>
        )}

        {/* Sentiment — honest, minimal */}
        <div style={{background:'rgba(255,255,255,.02)',border:'1px solid rgba(255,255,255,.09)',borderRadius:8,padding:'10px 12px',marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <span style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.08em'}}>SENTIMENT</span>
            <span style={{fontSize:9,color:'#555',fontFamily:'monospace'}}>keyword-based · indicative only</span>
          </div>
          <SentimentBar score={score} label={label} color={color}/>
        </div>

        {/* ── Structured analysis ── */}
        <Section title="What happened">{analysis.whatHappened}</Section>
        <Section title="Why markets care">{analysis.whyMarketsCare}</Section>
        <Section title="Who is affected">{analysis.whoIsAffected}</Section>

        {/* Bull / Bear side by side */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:2,marginBottom:20}}>
          <div style={{background:'rgba(34,197,94,.04)',border:'1px solid rgba(34,197,94,.1)',borderRadius:8,padding:'12px'}}>
            <div style={{fontSize:9,color:'#22c55e',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:8}}>BULL CASE</div>
            <p style={{fontSize:12,color:'#999',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{analysis.bullCase}</p>
          </div>
          <div style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.1)',borderRadius:8,padding:'12px'}}>
            <div style={{fontSize:9,color:'#ef4444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:8}}>BEAR CASE</div>
            <p style={{fontSize:12,color:'#999',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{analysis.bearCase}</p>
          </div>
        </div>

        <Section title="What to watch next" accent="#f59e0b">{analysis.watchNext}</Section>

        <div style={{fontSize:9,color:'#333',fontFamily:'monospace',lineHeight:1.6,borderTop:'1px solid rgba(255,255,255,.08)',paddingTop:14}}>
          Analysis is rule-based and general — not personalised, not backtested, not financial advice. Always do your own research.
        </div>
      </div>
    </div>
  );
}

// ── Morning Briefing — pulls real market data ─────────────────
function MorningBriefing({onLaunch, dateStr, dark=true}){
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    // Fetch real indices and top news
    Promise.all([
      fetch(BACKEND+'/api/tickers?symbols=^NSEI,^GSPC,^DJI').then(r=>r.json()).catch(()=>[]),
      fetch(BACKEND+'/api/news?symbol=MARKET').then(r=>r.json()).catch(()=>[]),
    ]).then(([prices, news])=>{
      const built = [];

      // Add index prices
      if(Array.isArray(prices)){
        prices.forEach(p=>{
          if(p.price==='N/A') return;
          const name = p.symbol==='^NSEI'?'Nifty 50':p.symbol==='^GSPC'?'S&P 500':'Dow Jones';
          const dot = p.up?'#22c55e':'#ef4444';
          built.push({dot, text:`${name} ${p.up?'up':'down'} ${p.changePercent} — trading at ${p.price}.`});
        });
      }

      // Add top 2 news headlines as briefing points
      if(Array.isArray(news)){
        news.slice(0,2).forEach((n,i)=>{
          const dots = ['#60a5fa','#f59e0b'];
          if(n.headline) built.push({dot:dots[i], text:n.headline});
        });
      }

      // Fallback if nothing loaded
      if(!built.length){
        built.push(
          {dot:'#22c55e', text:'Nifty 50 and global markets are active. Open the feed for live data.'},
          {dot:'#60a5fa', text:'US tech stocks and Indian IT are closely watched today.'},
          {dot:'#f59e0b', text:'Check the feed for latest news on oil, currency, and FII flows.'},
        );
      }

      setItems(built);
      setLoading(false);
    });
  },[]);

  return (
    <div style={{maxWidth:680,margin:'0 auto',padding:'0 clamp(16px,4vw,28px) clamp(32px,5vw,48px)'}}>
      <div style={{background:'#0a0a14',border:'1px solid rgba(255,255,255,.1)',borderRadius:12,padding:'20px 22px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
          <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.1em'}}>MORNING BRIEFING</div>
          <div style={{fontSize:9,color:'#3a3a3a',fontFamily:'monospace'}}>{dateStr}</div>
        </div>
        <p style={{fontSize:'clamp(13px,2.5vw,15px)',color:'#777',lineHeight:1.9,fontFamily:'Georgia,serif',marginBottom:16}}>
          Good morning. Here is what you need to know before markets open today.
        </p>
        {loading?(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {[0,1,2].map(i=><div key={i} style={{height:14,background:'linear-gradient(90deg,#12121a 25%,#1a1a24 50%,#12121a 75%)',backgroundSize:'200% 100%',animation:'shimmer 1.4s infinite',borderRadius:3,width:i===0?'90%':i===1?'75%':'60%'}}/>)}
          </div>
        ):(
          items.map((item,i)=>(
            <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:i<items.length-1?10:0}}>
              <span style={{width:4,height:4,borderRadius:'50%',background:item.dot,flexShrink:0,marginTop:8}}/>
              <p style={{fontSize:'clamp(12px,2vw,13px)',color:'#666',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{item.text}</p>
            </div>
          ))
        )}
        <div style={{marginTop:16,paddingTop:14,borderTop:'1px solid rgba(255,255,255,.09)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:9,color:'#3a3a3a',fontFamily:'monospace'}}>live data · updates on refresh</span>
          <button onClick={onLaunch} style={{fontSize:10,color:'#555',background:'transparent',border:'1px solid rgba(255,255,255,.12)',borderRadius:5,padding:'5px 10px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>open feed</button>
        </div>
      </div>
    </div>
  );
}

// ── Homepage ──────────────────────────────────────────────────
function Homepage({onLaunch,dark=true}){
  const [time,setTime]=useState(new Date());
  const [alertIdx,setAlertIdx]=useState(0);
  const [tickers,setTickers]=useState(FALLBACK_TICKERS);

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const t=setInterval(()=>setAlertIdx(i=>(i+1)%SIGNALS.length),3200);return()=>clearInterval(t);},[]);
  useEffect(()=>{
    fetch(BACKEND+'/api/tickers?symbols=AAPL,NVDA,TSLA,RELIANCE.NS')
      .then(r=>r.json()).then(data=>{
        if(Array.isArray(data)&&data.length){
          const m=data.filter(d=>d.price!=='N/A').map(d=>({sym:d.symbol.replace('.NS',''),price:d.price,chg:d.changePercent,up:d.up}));
          if(m.length) setTickers(m);
        }
      }).catch(()=>{});
  },[]);

  const timeStr=time.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const dateStr=time.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});

  const SIGNALS=[
    {text:'Nifty breadth: 38 of 50 stocks advancing',color:'#22c55e'},
    {text:'NVDA unusual volume — 3.2x 30-day average',color:'#f59e0b'},
    {text:'RBI rate decision — repo rate unchanged',color:'#60a5fa'},
    {text:'Sensex FII inflow Rs 8,200 crore today',color:'#22c55e'},
    {text:'10Y yield +8bps on hawkish Fed commentary',color:'#ef4444'},
  ];

  const [demoNews, setDemoNews] = useState([
    {src:'ET Markets',title:'Nifty 50 crosses 25,400 — FIIs net buyers for third straight session',tag:'ti',time:'6m ago',score:72,label:'Positive',color:'#22c55e'},
    {src:'Bloomberg', title:'NVIDIA surpasses $3.2T market cap as AI chip demand accelerates',tag:'tt',time:'14m ago',score:81,label:'Positive',color:'#22c55e'},
    {src:'Reuters',   title:'Fed holds rates — one cut signalled before year end',tag:'tf',time:'31m ago',score:52,label:'Mixed',color:'#f59e0b'},
  ]);

  useEffect(()=>{
    const c=new AbortController();
    setTimeout(()=>c.abort(),12000);
    fetch(BACKEND+'/api/news?symbol=MARKET',{signal:c.signal})
      .then(r=>r.json())
      .then(data=>{
        if(Array.isArray(data)&&data.length>=3){
          const mapped=data.slice(0,3).map(n=>{
            const tag=n.headline?(
              /india|nifty|sensex|rbi/.test(n.headline.toLowerCase())?'ti':
              /nvidia|apple|google|microsoft|meta|tesla|chip/.test(n.headline.toLowerCase())?'tt':
              /fed|rate|inflation|fomc/.test(n.headline.toLowerCase())?'tf':'tg'
            ):'tg';
            const score=n.score||52;
            const label=score>60?'Positive':score<40?'Negative':'Mixed';
            const color=score>60?'#22c55e':score<40?'#ef4444':'#f59e0b';
            return{src:n.source||'Reuters',title:n.headline,tag,time:n.time||'',score,label,color};
          });
          setDemoNews(mapped);
        }
      }).catch(()=>{});
  },[]);

  return (
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'calc(100vh - 44px)',color:dark?'#f0f0f0':'#111',fontFamily:'sans-serif',overflowX:'hidden'}}>

      {/* Ticker */}
      <div style={{background:'#0a0a14',borderBottom:'1px solid rgba(255,255,255,.08)',height:28,overflow:'hidden',display:'flex',alignItems:'center'}}>
        <div style={{display:'flex',animation:'ticker 50s linear infinite',whiteSpace:'nowrap'}}>
          {[...tickers,...tickers,...tickers].map((t,i)=>(
            <span key={i} style={{display:'inline-flex',alignItems:'center',gap:8,padding:'0 20px',fontSize:11,fontFamily:'monospace',borderRight:'1px solid rgba(255,255,255,.08)'}}>
              <span style={{color:'#888',fontWeight:700,letterSpacing:'0.04em'}}>{t.sym}</span>
              <span style={{color:'#999'}}>{t.price}</span>
              <span style={{color:t.up?'#22c55e':'#ef4444',fontWeight:600}}>{t.chg}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <div style={{maxWidth:680,margin:'0 auto',padding:'clamp(48px,8vw,96px) clamp(20px,5vw,28px) clamp(40px,6vw,72px)',textAlign:'center'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:28,flexWrap:'wrap'}}>
          <span style={{fontSize:11,color:'#444',fontFamily:'monospace',letterSpacing:'0.06em'}}>{dateStr}</span>
          <span style={{width:1,height:10,background:'rgba(255,255,255,.12)'}}/>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:'#22c55e',fontFamily:'monospace'}}>
            <span style={{width:4,height:4,borderRadius:'50%',background:'#22c55e',animation:'pulse 1.8s infinite'}}/>
            LIVE {timeStr} IST
          </span>
        </div>

        <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(30px,6vw,60px)',fontWeight:700,color:'#f5f5f5',lineHeight:1.1,marginBottom:18,letterSpacing:'-0.025em'}}>
          India's stock market,<br/>
          <em style={{fontStyle:'italic',fontWeight:400,color:'#888'}}>finally explained.</em>
        </h1>

        <p style={{fontSize:'clamp(14px,2.5vw,16px)',color:'#888',lineHeight:1.9,maxWidth:440,margin:'0 auto 36px'}}>
          Live prices and real news for Indian and global markets. We tell you what it means — not just what happened.
        </p>

        <button onClick={onLaunch}
          style={{fontSize:'clamp(13px,2.5vw,15px)',color:'#07070f',background:'#efefef',border:'none',borderRadius:8,padding:'clamp(11px,2vw,14px) clamp(28px,5vw,40px)',cursor:'pointer',fontWeight:700,transition:'all .2s',marginBottom:10,display:'inline-block',WebkitTapHighlightColor:'transparent'}}
          onMouseEnter={e=>{e.target.style.background='#fff';e.target.style.transform='translateY(-1px)';}}
          onMouseLeave={e=>{e.target.style.background='#efefef';e.target.style.transform='translateY(0)';}}>
          Open the feed
        </button>
        <div style={{fontSize:11,color:'#222',fontFamily:'monospace'}}>free · no signup · no ads</div>
      </div>

      <MorningBriefing onLaunch={onLaunch} dateStr={dateStr} dark={dark}/>


      {/* Live demo panel */}
      <div style={{maxWidth:680,margin:'0 auto',padding:'0 clamp(16px,4vw,28px) clamp(48px,8vw,72px)'}}>
        <div style={{border:'1px solid rgba(255,255,255,.12)',borderRadius:12,overflow:'hidden'}}>
          <div style={{background:'#0a0a14',padding:'10px 16px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(255,255,255,.08)'}}>
            <span style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.1em',flexShrink:0}}>LIVE</span>
            <span style={{width:1,height:10,background:'rgba(255,255,255,.1)',flexShrink:0}}/>
            <span key={alertIdx} style={{fontSize:11,color:SIGNALS[alertIdx].color,fontFamily:'monospace',animation:'fadeIn .5s ease',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{SIGNALS[alertIdx].text}</span>
          </div>
          {demoNews.map((h,i)=>(
            <div key={i} onClick={onLaunch}
              style={{padding:'14px 16px',borderBottom:i<2?'1px solid rgba(255,255,255,.03)':'none',cursor:'pointer',transition:'background .15s'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.02)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontSize:9,color:'#444',fontFamily:'monospace',textTransform:'uppercase',letterSpacing:'0.06em',display:'block',marginBottom:5}}>{h.src}</span>
                  <span style={{fontSize:'clamp(12px,2.5vw,13px)',color:i===0?'#ddd':'#555',fontWeight:i===0?500:400,lineHeight:1.45,fontFamily:'Georgia,serif',display:'block'}}>{h.title}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
                  <Tag cls={h.tag} label={TAG_META[h.tag]&&TAG_META[h.tag].label||'Markets'}/>
                  <span style={{fontSize:9,color:'#444',fontFamily:'monospace',whiteSpace:'nowrap'}}>{h.time}</span>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{flex:1,height:1.5,background:'rgba(255,255,255,.08)',borderRadius:1}}>
                  <div style={{height:'100%',width:h.score+'%',background:h.color,borderRadius:1}}/>
                </div>
                <span style={{fontSize:9,color:'#444',fontFamily:'monospace',whiteSpace:'nowrap'}}>{h.label}</span>
              </div>
            </div>
          ))}
          <div onClick={onLaunch} style={{padding:'10px 16px',display:'flex',justifyContent:'center',cursor:'pointer',background:'rgba(0,0,0,.2)',transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.02)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.2)'}>
            <span style={{fontSize:11,color:'#555',fontFamily:'monospace'}}>open full feed</span>
          </div>
        </div>
      </div>

      {/* 3 honest value props */}
      <div style={{borderTop:'1px solid rgba(255,255,255,.08)',padding:'clamp(40px,7vw,72px) clamp(16px,4vw,28px)'}}>
        <div style={{maxWidth:680,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:2}}>
          {[
            {num:'01',title:'Live prices',   desc:'Nifty 50, Sensex, and 500+ major US stocks. Updated every 60 seconds. No delay.'},
            {num:'02',title:'Real news',     desc:'Covers all Nifty 50 stocks and 500 major US stocks — from Reuters, Bloomberg, and ET Markets.'},
            {num:'03',title:'Plain English', desc:'Click any headline and we tell you what it means — in plain language, not jargon.'},
          ].map((f,i)=>(
            <div key={i} style={{padding:'24px 20px',borderLeft:i>0?'1px solid rgba(255,255,255,.08)':'none'}}>
              <div style={{fontSize:10,color:'#555',fontFamily:'monospace',marginBottom:12}}>{f.num}</div>
              <div style={{fontSize:'clamp(13px,2vw,15px)',fontWeight:600,color:'#ddd',marginBottom:8,fontFamily:'Georgia,serif'}}>{f.title}</div>
              <div style={{fontSize:'clamp(11px,1.8vw,13px)',color:'#555',lineHeight:1.8}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* About — honest, personal */}
      <div style={{borderTop:'1px solid rgba(255,255,255,.08)',padding:'clamp(40px,7vw,72px) clamp(16px,4vw,28px)'}}>
        <div style={{maxWidth:540,margin:'0 auto'}}>
          <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:16}}>Why we built this</div>
          <p style={{fontSize:'clamp(14px,2.5vw,16px)',color:'#999',lineHeight:1.9,fontFamily:'Georgia,serif',marginBottom:16}}>
            Most finance apps assume you already know everything. They throw numbers at you with no context. We built Stoxify because we got tired of reading a headline and not knowing what to actually do with it.
          </p>
          <p style={{fontSize:'clamp(13px,2vw,14px)',color:'#555',lineHeight:1.9,fontFamily:'Georgia,serif'}}>
            Stoxify is not a trading terminal. It is not Bloomberg. It is a simple feed that tells you what is happening in markets and — more importantly — what it actually means. Built for the next generation of Indian investors.
          </p>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{borderTop:'1px solid rgba(255,255,255,.08)',padding:'clamp(48px,8vw,80px) clamp(16px,4vw,28px)',textAlign:'center'}}>
        <h2 style={{fontFamily:'Georgia,serif',fontSize:'clamp(22px,4vw,38px)',fontWeight:700,color:'#f5f5f5',marginBottom:24,letterSpacing:'-0.015em',lineHeight:1.2}}>
          Stop guessing.<br/>
          <em style={{fontStyle:'italic',fontWeight:400,color:'#555'}}>Start understanding.</em>
        </h2>
        <button onClick={onLaunch}
          style={{fontSize:'clamp(13px,2vw,15px)',color:'#07070f',background:'#efefef',border:'none',borderRadius:8,padding:'clamp(11px,2vw,14px) clamp(28px,5vw,40px)',cursor:'pointer',fontWeight:700,transition:'all .2s',WebkitTapHighlightColor:'transparent'}}
          onMouseEnter={e=>{e.target.style.background='#fff';e.target.style.transform='translateY(-1px)';}}
          onMouseLeave={e=>{e.target.style.background='#efefef';e.target.style.transform='translateY(0)';}}>
          Open Stoxify
        </button>
      </div>

      <div style={{borderTop:'1px solid rgba(255,255,255,.08)',padding:'16px clamp(16px,4vw,28px)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <span style={{fontSize:14,fontWeight:700,color:'#555',fontFamily:'Georgia,serif'}}>Stoxify</span>
        <span style={{fontSize:9,color:'#555',fontFamily:'monospace'}}>Built for India · Sentiment is indicative only · Not financial advice</span>
        <span style={{fontSize:9,color:'#555',fontFamily:'monospace'}}>{timeStr} IST</span>
      </div>
    </div>
  );
}

// ── News Feed ─────────────────────────────────────────────────
function NewsFeed({initialSym='MARKET',dark=true}){
  const [articles,setArticles]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [tickerInput,setTickerInput]=useState('');
  const [activeSym,setActiveSym]=useState(initialSym);
  const [ts,setTs]=useState('');
  const [selected,setSelected]=useState(null);
  const [secsSince,setSecsSince]=useState(0);
  const [stockPrice,setStockPrice]=useState(null);
  const lastFetch=useRef(0);

  const nowStr=()=>new Date().toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,day:'numeric',month:'short'})+' IST';

  const guessTag=h=>{
    const s=h.toLowerCase();
    if(/earnings|revenue|profit|eps|results|beat|miss/.test(s))return'earnings';
    if(/fed|fomc|rate|inflation|gdp|cpi|rbi|monetary/.test(s))return'fed';
    if(/ipo|listing|debut|sebi/.test(s))return'ipo';
    if(/india|nifty|sensex|rupee|dalal|bse/.test(s))return'india';
    if(/nvidia|apple|google|microsoft|meta|tesla|chip|nasdaq/.test(s))return'tech';
    return'general';
  };

  const doFetch=async(sym,signal)=>{
    const res=await fetch(BACKEND+'/api/news?symbol='+sym,{signal});
    if(!res.ok)throw new Error('status '+res.status);
    const data=await res.json();
    const items=Array.isArray(data)?data:[];
    if(!items.length)throw new Error('empty');
    return items.map((a,i)=>{
      const tag=guessTag(a.headline||'');
      const sent=calcSentiment(a.headline,a.summary,a.source,tag);
      return{title:a.headline||'',desc:a.summary||'',body:a.full||a.summary||'',url:a.url||'',source:a.source||SOURCES[i%SOURCES.length],tagMeta:TAG_META[tag]||TAG_META.general,tag,time:a.time||agoLabel(i),score:sent.score,label:sent.label,color:sent.color};
    });
  };

  const fetchNews=useCallback(async(sym='MARKET')=>{
    setLoading(true);setError('');setSelected(null);setTs(nowStr());setActiveSym(sym);
    // Try up to 3 times with increasing timeouts
    const timeouts=[8000,12000,16000];
    let lastErr='';
    for(let attempt=0;attempt<3;attempt++){
      try{
        const controller=new AbortController();
        const t=setTimeout(()=>controller.abort(),timeouts[attempt]);
        const items=await doFetch(sym,controller.signal);
        clearTimeout(t);
        setArticles(items);
        lastFetch.current=Date.now();
        setLoading(false);
        return;
      }catch(e){
        lastErr=e.message;
        // small delay between retries
        if(attempt<2) await new Promise(r=>setTimeout(r,1000));
      }
    }
    setError('Could not load news — '+lastErr+'. Try refreshing.');
    setLoading(false);
  },[]);

  const openArticle=useCallback(article=>{setSelected(article);},[]);

  // Fetch price when searching a specific stock
  useEffect(()=>{
    if(activeSym==='MARKET'){setStockPrice(null);return;}
    fetch(BACKEND+'/api/price?symbol='+resolveTicker(activeSym))
      .then(r=>r.json())
      .then(d=>{if(d.price&&d.price!=='N/A')setStockPrice(d);else setStockPrice(null);})
      .catch(()=>setStockPrice(null));
  },[activeSym]);

  useEffect(()=>{fetchNews();},[fetchNews]);
  useEffect(()=>{const t=setInterval(()=>fetchNews(activeSym),60000);return()=>clearInterval(t);},[fetchNews,activeSym]);
  useEffect(()=>{const t=setInterval(()=>setSecsSince(Math.floor((Date.now()-lastFetch.current)/1000)),1000);return()=>clearInterval(t);},[]);

  const visible=articles.filter(a=>filter==='all'||a.tag===filter).filter(a=>!search||(a.title+a.desc).toLowerCase().includes(search.toLowerCase()));
  const [hero,...rest]=visible;
  const grid=rest.slice(0,4);
  const rows=rest.slice(4);
  const freshLabel=lastFetch.current===0?'':secsSince<60?secsSince+'s ago':Math.floor(secsSince/60)+'m ago';

  return (
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'calc(100vh - 44px)',color:dark?'#f0f0f0':'#111',fontFamily:'sans-serif'}}>
      {selected&&<ArticleModal article={selected} onClose={()=>setSelected(null)} dark={dark}/>}

      {/* Alert bar */}
      <div style={{background:'#0a0a14',borderBottom:'1px solid rgba(255,255,255,.08)',padding:'0 16px',height:30,display:'flex',alignItems:'center',gap:12,overflowX:'auto'}}>
        {[
          {text:'NVDA vol spike 3.2x avg',color:'#f59e0b'},
          {text:'Nifty breadth 38/50 advancing',color:'#22c55e'},
          {text:'10Y yield +8bps',color:'#ef4444'},
        ].map((a,i)=>(
          <span key={i} style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,fontFamily:'monospace',color:a.color,whiteSpace:'nowrap',paddingRight:12,borderRight:i<2?'1px solid rgba(255,255,255,.08)':'none',flexShrink:0}}>
            <span style={{width:3,height:3,borderRadius:'50%',background:a.color,animation:'pulse 2s infinite',flexShrink:0}}/>
            {a.text}
          </span>
        ))}
        <span style={{fontSize:9,color:'#555',fontFamily:'monospace',marginLeft:'auto',flexShrink:0}}>refreshes every 60s</span>
      </div>

      {/* Stock price bar */}
      {stockPrice&&activeSym!=='MARKET'&&(
        <div style={{background:dark?'#0d0d18':'#ffffff',borderBottom:`1px solid ${dark?'rgba(255,255,255,.09)':'rgba(0,0,0,.08)'}`,padding:'12px 16px',display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:4}}>{activeSym}</div>
            <div style={{fontSize:'clamp(22px,4vw,28px)',fontWeight:700,color:dark?'#e8e8e8':'#111',fontFamily:'monospace',lineHeight:1}}>{stockPrice.price}</div>
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:600,fontFamily:'monospace',color:stockPrice.up?'#22c55e':'#ef4444'}}>{stockPrice.changePercent}</div>
            <div style={{fontSize:11,color:'#444',fontFamily:'monospace'}}>{stockPrice.change} today</div>
          </div>
          {stockPrice.currency&&<div style={{fontSize:9,color:'#333',fontFamily:'monospace',marginLeft:'auto'}}>{stockPrice.currency}</div>}
        </div>
      )}

      {/* Controls */}
      <div style={{borderBottom:'1px solid rgba(255,255,255,.09)',background:dark?'#07070f':'#f8f8f5'}}>
        <div style={{display:'flex',alignItems:'center',padding:'8px 16px',gap:8,borderBottom:'1px solid rgba(255,255,255,.03)'}}>
          <form onSubmit={e=>{e.preventDefault();if(tickerInput.trim())fetchNews(resolveTicker(tickerInput));}} style={{display:'flex',gap:6,alignItems:'center',flex:1}}>
            <input value={tickerInput} onChange={e=>setTickerInput(e.target.value.toUpperCase())}
              style={{flex:1,maxWidth:130,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.08)',borderRadius:6,padding:'7px 10px',fontSize:12,color:'#ddd',fontFamily:'monospace',outline:'none',WebkitAppearance:'none'}}
              placeholder="AAPL, RELIANCE.NS..."/>
            <button type="submit" style={{fontSize:10,color:'#888',background:'transparent',border:'1px solid rgba(255,255,255,.08)',borderRadius:5,padding:'7px 10px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>go</button>
            {activeSym!=='MARKET'&&<><span style={{fontSize:10,color:'#22c55e',fontFamily:'monospace'}}>{activeSym}</span><button onClick={()=>{setTickerInput('');fetchNews('MARKET');}} style={{fontSize:10,color:'#555',background:'transparent',border:'none',cursor:'pointer',padding:'0 4px',WebkitTapHighlightColor:'transparent'}}>x</button></>}
          </form>
          <input style={{flex:1,maxWidth:120,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.1)',borderRadius:5,padding:'7px 10px',fontSize:11,color:'#888',fontFamily:'monospace',outline:'none',WebkitAppearance:'none'}}
            placeholder="filter..." value={search} onChange={e=>setSearch(e.target.value)}/>
          <button onClick={()=>fetchNews(activeSym)} disabled={loading} style={{fontSize:10,color:loading?'#1e1e1e':'#444',background:'transparent',border:'1px solid rgba(255,255,255,.1)',borderRadius:5,padding:'7px 10px',cursor:loading?'not-allowed':'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>
            <span style={loading?{display:'inline-block',animation:'spin .8s linear infinite'}:{}}>r</span>
          </button>
        </div>
        <div style={{display:'flex',overflowX:'auto',padding:'0 12px',WebkitOverflowScrolling:'touch'}}>
          {[['all','All'],['earnings','Earnings'],['tech','Tech'],['fed','Fed'],['india','India'],['ipo','IPO']].map(([tag,label])=>(
            <button key={tag} onClick={()=>setFilter(tag)}
              style={{fontSize:10,color:filter===tag?'#ccc':'#2a2a2a',background:'transparent',border:'none',cursor:'pointer',fontFamily:'monospace',padding:'8px 10px',whiteSpace:'nowrap',borderBottom:filter===tag?'2px solid #555':'2px solid transparent',transition:'all .12s',flexShrink:0,WebkitTapHighlightColor:'transparent'}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:'12px 16px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:10,fontFamily:'monospace'}}>
            <span style={{width:4,height:4,borderRadius:'50%',background:loading?'#333':error?'#ef4444':'#22c55e',animation:(!loading&&!error&&articles.length)?'pulse 2s infinite':'none'}}/>
            <span style={{color:loading?'#333':error?'#ef4444':'#22c55e'}}>{loading?'loading...':error?'error':articles.length?'live':'idle'}</span>
            {freshLabel&&!loading&&<span style={{color:'#555'}}> · updated {freshLabel}</span>}
          </span>
          <span style={{fontSize:9,color:'#555',fontFamily:'monospace'}}>{ts}</span>
        </div>

        {!loading&&!error&&articles.length>0&&(
          <div style={{fontSize:9,color:'#555',fontFamily:'monospace',marginBottom:10}}>tap any headline to see what it means</div>
        )}

        {!loading&&error&&(
          <div style={{textAlign:'center',padding:'40px 20px'}}>
            <div style={{fontSize:12,color:'#555',marginBottom:12,fontFamily:'monospace'}}>{error}</div>
            <button onClick={()=>fetchNews(activeSym)} style={{padding:'8px 16px',background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.08)',borderRadius:6,color:'#888',fontSize:11,fontFamily:'monospace',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>retry</button>
          </div>
        )}

        {loading&&(
          <>
            <div style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'18px 16px',marginBottom:2}}>
              <Skel w="70px" h={8} mb={10}/><Skel w="88%" h={16} mb={6}/><Skel w="65%" h={16} mb={12}/>
              <Skel w="100%" h={2} mb={8}/><Skel w="55%" h={8}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,overflow:'hidden',marginBottom:2}}>
              {[0,1,2,3].map(i=><div key={i} style={{background:'#0d0d18',padding:'14px'}}><Skel w="55px" h={8} mb={8}/><Skel w="88%" h={12} mb={5}/><Skel w="68%" h={12}/></div>)}
            </div>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:7,padding:'12px',marginBottom:2}}>
                <div><Skel w="65px" h={8} mb={7}/><Skel w="82%" h={11}/></div><Skel w="42px" h={8}/>
              </div>
            ))}
          </>
        )}

        {!loading&&!error&&articles.length>0&&visible.length===0&&<div style={{textAlign:'center',padding:'40px',color:'#444',fontSize:11,fontFamily:'monospace'}}>no results — try a different filter</div>}

        {!loading&&!error&&hero&&(
          <div onClick={()=>openArticle(hero)}
            style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.12)',borderRadius:10,padding:'18px 16px',marginBottom:2,cursor:'pointer',transition:'border-color .15s',WebkitTapHighlightColor:'transparent'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.13)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.12)'}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
              <span style={{fontSize:9,color:'#555',letterSpacing:'.08em',textTransform:'uppercase',fontFamily:'monospace'}}>{hero.source}</span>
              <Tag cls={hero.tagMeta.cls} label={hero.tagMeta.label}/>
              <span style={{fontSize:9,color:'#444',fontFamily:'monospace',marginLeft:'auto'}}>{hero.time}</span>
            </div>
            <div style={{fontSize:'clamp(15px,3vw,18px)',fontWeight:700,color:'#f5f5f5',lineHeight:1.35,marginBottom:10,fontFamily:'Georgia,serif'}}>{hero.title}</div>
            {hero.desc&&<div style={{fontSize:'clamp(11px,2vw,13px)',color:'#555',lineHeight:1.7,marginBottom:12}}>{hero.desc}</div>}
            <SentimentBar score={hero.score||50} label={hero.label||'Mixed'} color={hero.color||'#f59e0b'}/>
          </div>
        )}

        {!loading&&!error&&grid.length>0&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:1,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,overflow:'hidden',marginBottom:2}}>
            {grid.map((a,i)=>(
              <div key={i} onClick={()=>openArticle(a)}
                style={{background:dark?'#0d0d18':'#ffffff',padding:'14px',display:'flex',flexDirection:'column',gap:6,cursor:'pointer',transition:'background .12s',WebkitTapHighlightColor:'transparent'}}
                onMouseEnter={e=>e.currentTarget.style.background=dark?'#13131e':'#f5f5f2'}
                onMouseLeave={e=>e.currentTarget.style.background=dark?'#0d0d18':'#ffffff'}>
                <div style={{fontSize:9,color:'#444',letterSpacing:'.06em',textTransform:'uppercase',fontFamily:'monospace'}}>{a.source}</div>
                <div style={{fontSize:'clamp(11px,2vw,12px)',fontWeight:600,color:'#ddd',lineHeight:1.42,fontFamily:'Georgia,serif',flex:1}}>{a.title}</div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingTop:4}}>
                  <span style={{fontSize:9,color:'#444',fontFamily:'monospace'}}>{a.time}</span>
                  <Tag cls={a.tagMeta.cls} label={a.tagMeta.label}/>
                </div>
                <div style={{height:1.5,background:'rgba(255,255,255,.08)',borderRadius:1}}>
                  <div style={{height:'100%',width:(a.score||50)+'%',background:a.color||'#f59e0b',borderRadius:1}}/>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading&&!error&&rows.map((a,i)=>(
          <div key={i} onClick={()=>openArticle(a)}
            style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'center',background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:7,padding:'12px',marginBottom:2,cursor:'pointer',transition:'border-color .15s',WebkitTapHighlightColor:'transparent'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.1)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.09)'}>
            <div>
              <div style={{fontSize:9,color:'#444',letterSpacing:'.06em',textTransform:'uppercase',fontFamily:'monospace',marginBottom:3}}>{a.source}</div>
              <div style={{fontSize:'clamp(11px,2vw,12px)',fontWeight:600,color:'#ccc',lineHeight:1.38,fontFamily:'Georgia,serif'}}>{a.title}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5}}>
              <span style={{fontSize:9,color:'#444',fontFamily:'monospace',whiteSpace:'nowrap'}}>{a.time}</span>
              <Tag cls={a.tagMeta.cls} label={a.tagMeta.label}/>
            </div>
          </div>
        ))}

        {!loading&&!error&&articles.length>0&&<div style={{fontSize:9,color:'#333',fontFamily:'monospace',textAlign:'center',paddingTop:14}}>stoxify · sentiment is indicative only · not financial advice</div>}
      </div>
    </div>
  );
}

// ── Watchlist ─────────────────────────────────────────────────
function Watchlist({onSearch,dark=true}){
  const [list,setList]=useState(()=>{try{return JSON.parse(localStorage.getItem('stoxify_wl')||'[]');}catch{return[];}});
  const [input,setInput]=useState('');
  const [prices,setPrices]=useState({});
  const [loading,setLoading]=useState(false);

  const save=nl=>{setList(nl);try{localStorage.setItem('stoxify_wl',JSON.stringify(nl));}catch{}};
  const add=()=>{const s=resolveTicker(input);if(!s||list.includes(s))return;save([...list,s]);setInput('');};
  const remove=s=>save(list.filter(x=>x!==s));

  useEffect(()=>{
    if(!list.length)return;
    setLoading(true);
    fetch(BACKEND+'/api/tickers?symbols='+list.join(','))
      .then(r=>r.json()).then(data=>{if(Array.isArray(data)){const m={};data.forEach(d=>{m[d.symbol]=d;});setPrices(m);}})
      .catch(()=>{}).finally(()=>setLoading(false));
  },[list]);

  const QUICK=['AAPL','NVDA','TSLA','MSFT','RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS'];

  return (
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'calc(100vh - 44px)',padding:'20px 16px',maxWidth:640,margin:'0 auto',color:dark?'#f0f0f0':'#111',fontFamily:'sans-serif'}}>
      <div style={{marginBottom:20}}>
        <h2 style={{fontFamily:'Georgia,serif',fontSize:'clamp(18px,4vw,22px)',fontWeight:700,color:'#e8e8e8',marginBottom:6}}>Watchlist</h2>
        <p style={{fontSize:11,color:'#444',fontFamily:'monospace',lineHeight:1.6}}>US stocks: AAPL, NVDA · Indian stocks: RELIANCE.NS, TCS.NS, INFY.NS</p>
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        <input value={input} onChange={e=>setInput(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&add()}
          style={{flex:1,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.08)',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#ddd',fontFamily:'monospace',outline:'none',WebkitAppearance:'none'}}
          placeholder="Add ticker..."/>
        <button onClick={add} style={{fontSize:13,color:'#07070f',background:'#ddd',border:'none',borderRadius:8,padding:'10px 18px',cursor:'pointer',fontWeight:700,WebkitTapHighlightColor:'transparent'}}>+</button>
      </div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:8}}>QUICK ADD</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {QUICK.map(s=>(
            <button key={s} onClick={()=>{if(!list.includes(s))save([...list,s]);}}
              style={{fontSize:10,color:list.includes(s)?'#22c55e':'#333',background:'rgba(255,255,255,.03)',border:'1px solid '+(list.includes(s)?'rgba(34,197,94,.15)':'rgba(255,255,255,.1)'),borderRadius:5,padding:'5px 10px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {list.length===0&&(
        <div style={{textAlign:'center',padding:'60px 20px'}}>
          <div style={{fontSize:13,color:'#444',marginBottom:8,fontFamily:'monospace'}}>no stocks saved yet</div>
        </div>
      )}
      {list.map(sym=>{
        const p=prices[sym];
        return(
          <div key={sym} style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:10,alignItems:'center',background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'14px',marginBottom:2,transition:'border-color .15s'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.1)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,.09)'}>
            <div style={{fontSize:'clamp(12px,2.5vw,14px)',fontWeight:700,color:'#ddd',fontFamily:'monospace'}}>{sym}</div>
            <div style={{fontSize:'clamp(12px,2.5vw,13px)',color:'#999',fontFamily:'monospace'}}>{loading?'...':p&&p.price!=='N/A'?p.price:'--'}</div>
            <div style={{fontSize:12,fontWeight:600,fontFamily:'monospace',color:p&&p.up?'#22c55e':'#ef4444',minWidth:55,textAlign:'right'}}>{p&&p.changePercent!=='N/A'?p.changePercent:''}</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>onSearch(sym)} style={{fontSize:10,color:'#555',background:'transparent',border:'1px solid rgba(255,255,255,.12)',borderRadius:5,padding:'5px 8px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>news</button>
              <button onClick={()=>remove(sym)} style={{fontSize:10,color:'#888',background:'transparent',border:'1px solid rgba(255,255,255,.09)',borderRadius:5,padding:'5px 7px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>x</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Compare ───────────────────────────────────────────────────
function Compare({dark=true}){
  const [stocks,setStocks]=useState(['AAPL','NVDA']);
  const [input,setInput]=useState('');
  const [prices,setPrices]=useState({});
  const [news,setNews]=useState({});
  const [loading,setLoading]=useState(false);
  const [priceErr,setPriceErr]=useState('');

  const loadPrices=useCallback(async syms=>{
    setPriceErr('');
    try{
      const controller=new AbortController();
      setTimeout(()=>controller.abort(),10000);
      const r=await fetch(BACKEND+'/api/tickers?symbols='+syms.join(','),{signal:controller.signal});
      const d=await r.json();
      if(Array.isArray(d)){
        const m={};d.forEach(x=>{m[x.symbol]=x;});setPrices(m);
        if(d.every(x=>x.price==='N/A')) setPriceErr('Price data unavailable — quota may be exhausted. Resets at midnight UTC.');
      }
    }catch{setPriceErr('Could not load prices.');}
  },[]);

  const loadNews=useCallback(async syms=>{
    const nm={};
    await Promise.all(syms.map(async s=>{
      try{
        const controller=new AbortController();
        setTimeout(()=>controller.abort(),10000);
        const r=await fetch(BACKEND+'/api/news?symbol='+s,{signal:controller.signal});
        const d=await r.json();
        nm[s]=Array.isArray(d)?d.slice(0,3):[];
      }catch{nm[s]=[];}
    }));
    setNews(nm);
  },[]);

  const load=useCallback(async syms=>{
    if(!syms.length)return;
    setLoading(true);
    await Promise.all([loadPrices(syms),loadNews(syms)]);
    setLoading(false);
  },[loadPrices,loadNews]);

  useEffect(()=>{load(stocks);},[stocks,load]);

  const add=()=>{const s=resolveTicker(input);if(!s||stocks.includes(s)||stocks.length>=3)return;setStocks([...stocks,s]);setInput('');};
  const remove=s=>setStocks(stocks.filter(x=>x!==s));

  return(
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'calc(100vh - 44px)',padding:'20px 16px',color:dark?'#f0f0f0':'#111',fontFamily:'sans-serif'}}>
      <div style={{maxWidth:960,margin:'0 auto'}}>
        <div style={{marginBottom:18}}>
          <h2 style={{fontFamily:'Georgia,serif',fontSize:'clamp(18px,4vw,22px)',fontWeight:700,color:'#e8e8e8',marginBottom:4}}>Compare</h2>
          <p style={{fontSize:11,color:'#444',fontFamily:'monospace'}}>Up to 3 stocks side by side · US: AAPL · India: RELIANCE.NS, TCS.NS</p>
        </div>
        {priceErr&&<div style={{fontSize:10,color:'#f59e0b',fontFamily:'monospace',background:'rgba(245,158,11,.07)',border:'1px solid rgba(245,158,11,.15)',borderRadius:6,padding:'8px 12px',marginBottom:14}}>{priceErr}</div>}
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <input value={input} onChange={e=>setInput(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&add()}
            style={{flex:1,minWidth:120,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.08)',borderRadius:8,padding:'9px 12px',fontSize:12,color:'#ddd',fontFamily:'monospace',outline:'none',WebkitAppearance:'none'}}
            placeholder="Add ticker..."/>
          <button onClick={add} disabled={stocks.length>=3} style={{fontSize:11,color:stocks.length>=3?'#222':'#07070f',background:stocks.length>=3?'rgba(255,255,255,.03)':'#ddd',border:'none',borderRadius:8,padding:'9px 16px',cursor:stocks.length>=3?'not-allowed':'pointer',fontWeight:700,WebkitTapHighlightColor:'transparent'}}>{stocks.length>=3?'max 3':'+Add'}</button>
          <button onClick={()=>load(stocks)} disabled={loading} style={{fontSize:11,color:'#555',background:'transparent',border:'1px solid rgba(255,255,255,.12)',borderRadius:8,padding:'9px 14px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>
            <span style={loading?{display:'inline-block',animation:'spin .8s linear infinite'}:{}}>r</span>
          </button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:2}}>
          {stocks.map(sym=>{
            const p=prices[sym];
            const n=news[sym]||[];
            return(
              <div key={sym} style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.1)',borderRadius:10,overflow:'hidden'}}>
                <div style={{padding:'12px 14px',borderBottom:'1px solid rgba(255,255,255,.09)',background:'#0a0a14',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontSize:'clamp(12px,2.5vw,14px)',fontWeight:700,color:'#ddd',fontFamily:'monospace'}}>{sym}</div>
                    <div style={{fontSize:9,color:'#444',fontFamily:'monospace',marginTop:2}}>{p&&p.price!=='N/A'?'live':'--'}</div>
                  </div>
                  <button onClick={()=>remove(sym)} style={{fontSize:11,color:'#555',background:'transparent',border:'none',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>x</button>
                </div>
                <div style={{padding:'14px',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
                  <div style={{fontSize:'clamp(18px,4vw,22px)',fontWeight:700,color:'#e8e8e8',fontFamily:'monospace',marginBottom:3}}>{loading?'...':p&&p.price!=='N/A'?p.price:'--'}</div>
                  <div style={{fontSize:12,fontWeight:600,fontFamily:'monospace',color:p&&p.up?'#22c55e':'#ef4444'}}>{p&&p.changePercent!=='N/A'?p.changePercent:''}</div>
                  <div style={{fontSize:10,color:'#444',fontFamily:'monospace',marginTop:3}}>{p&&p.change!=='N/A'?p.change+' today':''}</div>
                </div>
                <div style={{padding:'12px 14px'}}>
                  <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.07em',marginBottom:10}}>LATEST NEWS</div>
                  {n.length===0&&<div style={{fontSize:10,color:'#555',fontFamily:'monospace'}}>no news</div>}
                  {n.map((a,i)=>(
                    <div key={i} style={{marginBottom:10,paddingBottom:10,borderBottom:i<n.length-1?'1px solid rgba(255,255,255,.08)':'none'}}>
                      <div style={{fontSize:'clamp(11px,2vw,12px)',fontWeight:500,color:'#999',lineHeight:1.45,fontFamily:'Georgia,serif',marginBottom:4}}>{a.headline}</div>
                      <span style={{fontSize:9,color:'#444',fontFamily:'monospace'}}>{a.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ── Daily Briefing Page ───────────────────────────────────────
function Briefing({dark=true}){
  const [data, setData] = useState({indices:[], news:[], loaded:false, error:false});
  const [time, setTime] = useState(new Date());
  const [stockInput, setStockInput] = useState('');
  const [stockData, setStockData] = useState(null); // {price, news, loading, sym}

  const searchStock = async(sym) => {
    if(!sym.trim()) return;
    const resolved = resolveTicker(sym);
    setStockData({loading:true, sym:resolved, info:null, news:[]});
    try {
      const [infoRes, newsRes] = await Promise.allSettled([
        fetch(BACKEND+'/api/stockinfo?symbol='+resolved).then(r=>r.json()).catch(()=>null),
        fetch(BACKEND+'/api/news?symbol='+resolved).then(r=>r.json()).catch(()=>[]),
      ]);
      const info = infoRes.status==='fulfilled'?infoRes.value:null;
      const news = newsRes.status==='fulfilled'&&Array.isArray(newsRes.value)?newsRes.value:[];
      setStockData({loading:false, sym:resolved, info, news:news.slice(0,5)});
    } catch {
      setStockData({loading:false, sym:resolved, info:null, news:[]});
    }
  };

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);

  useEffect(()=>{
    const fetchWithTimeout=(url,ms=12000)=>{
      const c=new AbortController();
      setTimeout(()=>c.abort(),ms);
      return fetch(url,{signal:c.signal}).then(r=>r.json()).catch(()=>null);
    };
    const load=async()=>{
      // Load indices and news in parallel, movers separately
      const [indices,news,movers]=await Promise.all([
        fetchWithTimeout(BACKEND+'/api/tickers?symbols=^NSEI,^GSPC,^DJI,^IXIC'),
        fetchWithTimeout(BACKEND+'/api/news?symbol=MARKET'),
        fetchWithTimeout(BACKEND+'/api/tickers?symbols=AAPL,NVDA,TSLA,RELIANCE.NS,TCS.NS'),
      ]);
      // If first attempt fails, retry once
      const retryIndices = (!indices||!Array.isArray(indices)||!indices.length)
        ? await fetchWithTimeout(BACKEND+'/api/tickers?symbols=^NSEI,^GSPC,^DJI').catch(()=>null)
        : indices;
      const retryNews = (!news||!Array.isArray(news)||!news.length)
        ? await fetchWithTimeout(BACKEND+'/api/news?symbol=AAPL').catch(()=>null)
        : news;
      setData({
        indices:Array.isArray(retryIndices)?retryIndices:[],
        news:Array.isArray(retryNews)?retryNews:[],
        movers:Array.isArray(movers)?movers:[],
        loaded:true,
        error:false,
      });
    };
    load();
  },[]);

  const dateStr = time.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const timeStr = time.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const greeting = time.getHours()<12?'Good morning':time.getHours()<17?'Good afternoon':'Good evening';

  const IndexCard = ({p}) => {
    if(!p||p.price==='N/A') return null;
    const name = p.symbol==='^NSEI'?'Nifty 50':p.symbol==='^GSPC'?'S&P 500':p.symbol==='^DJI'?'Dow Jones':'NASDAQ';
    return (
      <div style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'16px 18px'}}>
        <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:10,textTransform:'uppercase'}}>{name}</div>
        <div style={{fontSize:'clamp(20px,4vw,26px)',fontWeight:700,color:'#e8e8e8',fontFamily:'monospace',marginBottom:4}}>{p.price}</div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:13,fontWeight:600,fontFamily:'monospace',color:p.up?'#22c55e':'#ef4444'}}>{p.changePercent}</span>
          <span style={{fontSize:10,color:'#444',fontFamily:'monospace'}}>{p.change} today</span>
        </div>
      </div>
    );
  };

  const MoverRow = ({p}) => {
    if(!p||p.price==='N/A') return null;
    return (
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
        <span style={{fontSize:12,fontWeight:700,color:'#ccc',fontFamily:'monospace'}}>{p.symbol.replace('.NS','')}</span>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span style={{fontSize:12,color:'#888',fontFamily:'monospace'}}>{p.price}</span>
          <span style={{fontSize:12,fontWeight:600,fontFamily:'monospace',color:p.up?'#22c55e':'#ef4444',minWidth:60,textAlign:'right'}}>{p.changePercent}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'calc(100vh - 44px)',color:dark?'#f0f0f0':'#111',fontFamily:'sans-serif',padding:'28px clamp(16px,4vw,28px)'}}>
      <div style={{maxWidth:720,margin:'0 auto'}}>

        {/* Stock search */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Stock lookup</div>
          <div style={{display:'flex',gap:8,marginBottom:8}}>
            <input value={stockInput} onChange={e=>setStockInput(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==='Enter'&&searchStock(stockInput)}
              style={{flex:1,background:dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.05)',border:`1px solid ${dark?'rgba(255,255,255,.1)':'rgba(0,0,0,.1)'}`,borderRadius:8,padding:'10px 14px',fontSize:13,color:dark?'#ddd':'#111',fontFamily:'monospace',outline:'none',WebkitAppearance:'none'}}
              placeholder="AAPL, RELIANCE, NIFTY..."/>
            <button onClick={()=>searchStock(stockInput)}
              style={{fontSize:12,color:dark?'#07070f':'#fff',background:dark?'#ddd':'#111',border:'none',borderRadius:8,padding:'10px 20px',cursor:'pointer',fontWeight:700,WebkitTapHighlightColor:'transparent'}}>
              Search
            </button>
            {stockData&&<button onClick={()=>setStockData(null)}
              style={{fontSize:11,color:'#444',background:'transparent',border:`1px solid ${dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)'}`,borderRadius:8,padding:'10px 14px',cursor:'pointer',fontFamily:'monospace',WebkitTapHighlightColor:'transparent'}}>
              clear
            </button>}
          </div>
          <div style={{fontSize:10,color:'#2a2a2a',fontFamily:'monospace'}}>
            US: AAPL, NVDA, TSLA · Indian: RELIANCE, TCS, INFY · Indices: NIFTY, SENSEX
          </div>
        </div>

        {/* Stock analysis panel */}
        {stockData&&(
          <div style={{background:dark?'#0d0d18':'#ffffff',border:`1px solid ${dark?'rgba(255,255,255,.09)':'rgba(0,0,0,.08)'}`,borderRadius:12,overflow:'hidden',marginBottom:28}}>

            {/* Header */}
            <div style={{background:dark?'#0a0a14':'#f0f0ec',padding:'14px 18px',borderBottom:`1px solid ${dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)'}`,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{fontSize:9,color:'#444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:3}}>STOCK ANALYSIS</div>
                <div style={{fontSize:16,fontWeight:700,color:dark?'#ddd':'#111',fontFamily:'monospace'}}>{stockData.sym}</div>
                {stockData.info?.name&&stockData.info.name!==stockData.sym&&<div style={{fontSize:11,color:'#555',fontFamily:'monospace',marginTop:2}}>{stockData.info.name}</div>}
              </div>
              {stockData.loading&&<div style={{fontSize:11,color:'#444',fontFamily:'monospace',animation:'pulse 1s infinite'}}>loading...</div>}
              {!stockData.loading&&stockData.info?.signal&&stockData.info.signal!=='N/A'&&(
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:9,color:'#333',fontFamily:'monospace',marginBottom:4}}>SIGNAL</div>
                  <div style={{fontSize:15,fontWeight:700,fontFamily:'monospace',color:stockData.info.signal==='BUY'?'#22c55e':stockData.info.signal==='SELL'?'#ef4444':'#f59e0b',padding:'4px 12px',background:stockData.info.signal==='BUY'?'rgba(34,197,94,.1)':stockData.info.signal==='SELL'?'rgba(239,68,68,.1)':'rgba(245,158,11,.1)',borderRadius:6,border:`1px solid ${stockData.info.signal==='BUY'?'rgba(34,197,94,.2)':stockData.info.signal==='SELL'?'rgba(239,68,68,.2)':'rgba(245,158,11,.2)'}`}}>{stockData.info.signal}</div>
                </div>
              )}
            </div>

            {!stockData.loading&&stockData.info&&(
              <>
                {/* Price + sentiment */}
                <div style={{padding:'16px 18px',borderBottom:`1px solid ${dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'}`}}>
                  <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:12}}>
                    <div>
                      <div style={{fontSize:'clamp(26px,5vw,34px)',fontWeight:700,color:dark?'#e8e8e8':'#111',fontFamily:'monospace',lineHeight:1,marginBottom:6}}>
                        {stockData.info.currentPrice?stockData.info.currentPrice.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'N/A'}
                        <span style={{fontSize:11,color:'#444',fontFamily:'monospace',marginLeft:6}}>{stockData.info.currency}</span>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:14,fontWeight:600,fontFamily:'monospace',color:stockData.info.changePct>=0?'#22c55e':'#ef4444'}}>
                          {stockData.info.changePct>=0?'+':''}{(stockData.info.changePct*100).toFixed(2)}%
                        </span>
                        <span style={{fontSize:12,color:'#444',fontFamily:'monospace'}}>
                          {stockData.info.change>=0?'+':''}{stockData.info.change?.toFixed(2)} today
                        </span>
                      </div>
                    </div>
                    {/* Sentiment bar */}
                    <div style={{minWidth:120}}>
                      <div style={{fontSize:9,color:'#333',fontFamily:'monospace',marginBottom:6}}>SENTIMENT</div>
                      <div style={{height:3,background:'rgba(255,255,255,.06)',borderRadius:2,marginBottom:4}}>
                        <div style={{height:'100%',width:stockData.info.sentimentScore+'%',background:stockData.info.sentimentScore>60?'#22c55e':stockData.info.sentimentScore<40?'#ef4444':'#f59e0b',borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:10,color:stockData.info.sentimentScore>60?'#22c55e':stockData.info.sentimentScore<40?'#ef4444':'#f59e0b',fontFamily:'monospace',fontWeight:600}}>{stockData.info.sentiment}</div>
                    </div>
                  </div>
                  {/* Signal reason */}
                  {stockData.info.signalReason&&<div style={{fontSize:12,color:'#555',fontFamily:'Georgia,serif',lineHeight:1.7,background:dark?'rgba(255,255,255,.02)':'rgba(0,0,0,.02)',borderRadius:6,padding:'10px 12px',borderLeft:`3px solid ${stockData.info.signal==='BUY'?'#22c55e':stockData.info.signal==='SELL'?'#ef4444':'#f59e0b'}`}}>{stockData.info.signalReason}</div>}
                </div>

                {/* Fundamentals grid */}
                <div style={{padding:'14px 18px',borderBottom:`1px solid ${dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'}`}}>
                  <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:12}}>KEY STATS</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12}}>
                    {[
                      {label:'Market Cap',   value:stockData.info.marketCap},
                      {label:'P/E Ratio',    value:stockData.info.peRatio},
                      {label:'EPS',          value:stockData.info.eps},
                      {label:'52W High',     value:stockData.info.week52High},
                      {label:'52W Low',      value:stockData.info.week52Low},
                      {label:'Volume',       value:stockData.info.volume},
                      {label:'Avg Volume',   value:stockData.info.avgVolume},
                      {label:'Beta',         value:stockData.info.beta},
                      {label:'Dividend',     value:stockData.info.dividendYield},
                      {label:'Target Price', value:stockData.info.targetPrice},
                    ].map((s,i)=>(
                      <div key={i}>
                        <div style={{fontSize:9,color:'#333',fontFamily:'monospace',marginBottom:3}}>{s.label}</div>
                        <div style={{fontSize:13,fontWeight:600,color:dark?'#ccc':'#222',fontFamily:'monospace'}}>{s.value||'N/A'}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bull / Bear */}
                {(()=>{
                  const tag = stockData.info.changePct>0.01?'tech':stockData.info.changePct<-0.01?'general':'general';
                  const sent = stockData.info.sentiment;
                  const analysis = getArticleAnalysis(stockData.sym+' stock analysis', '', tag, sent);
                  return(
                    <div style={{padding:'14px 18px',borderBottom:`1px solid ${dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'}`}}>
                      <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:12}}>ANALYSIS</div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:2,marginBottom:12}}>
                        <div style={{background:'rgba(34,197,94,.04)',border:'1px solid rgba(34,197,94,.1)',borderRadius:8,padding:'12px'}}>
                          <div style={{fontSize:9,color:'#22c55e',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:8}}>BULL CASE</div>
                          <p style={{fontSize:11,color:'#555',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{analysis.bullCase}</p>
                        </div>
                        <div style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.1)',borderRadius:8,padding:'12px'}}>
                          <div style={{fontSize:9,color:'#ef4444',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:8}}>BEAR CASE</div>
                          <p style={{fontSize:11,color:'#555',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{analysis.bearCase}</p>
                        </div>
                      </div>
                      <div style={{background:dark?'rgba(255,255,255,.02)':'rgba(0,0,0,.02)',borderRadius:6,padding:'10px 12px',borderLeft:'3px solid #f59e0b'}}>
                        <div style={{fontSize:9,color:'#f59e0b',fontFamily:'monospace',marginBottom:5}}>WHAT TO WATCH</div>
                        <p style={{fontSize:11,color:'#555',lineHeight:1.75,margin:0,fontFamily:'Georgia,serif'}}>{analysis.watchNext}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* News */}
                <div style={{padding:'14px 18px'}}>
                  <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.08em',marginBottom:12}}>LATEST NEWS</div>
                  {stockData.news.length===0&&<div style={{fontSize:12,color:'#333',fontFamily:'monospace'}}>no news found</div>}
                  {stockData.news.map((n,i)=>{
                    const sent=calcSentiment(n.headline,n.summary,n.source,'general');
                    return(
                      <div key={i} style={{paddingBottom:12,marginBottom:12,borderBottom:i<stockData.news.length-1?`1px solid ${dark?'rgba(255,255,255,.04)':'rgba(0,0,0,.05)'}`:' none'}}>
                        <div style={{fontSize:'clamp(12px,2.5vw,13px)',fontWeight:500,color:dark?'#ccc':'#222',lineHeight:1.5,fontFamily:'Georgia,serif',marginBottom:5}}>{n.headline}</div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:9,color:'#333',fontFamily:'monospace'}}>{n.source}</span>
                          <span style={{fontSize:9,color:'#333',fontFamily:'monospace'}}>· {n.time}</span>
                          <span style={{fontSize:9,color:sent.color,fontFamily:'monospace',marginLeft:'auto',fontWeight:600}}>{sent.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{padding:'10px 18px',fontSize:9,color:'#1e1e1e',fontFamily:'monospace'}}>
                  Analysis is rule-based and general · sentiment is indicative only · not financial advice
                </div>
              </>
            )}
          </div>
        )}

        {/* Header */}
        <div style={{marginBottom:32}}>
          <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>{dateStr}</div>
          <h1 style={{fontFamily:'Georgia,serif',fontSize:'clamp(24px,4vw,36px)',fontWeight:700,color:'#e8e8e8',lineHeight:1.2,marginBottom:10}}>
            {greeting}.<br/>
            <em style={{fontStyle:'italic',fontWeight:400,color:'#444'}}>Here is what markets are doing.</em>
          </h1>
          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:'#333',fontFamily:'monospace'}}>
            <span style={{width:4,height:4,borderRadius:'50%',background:'#22c55e',animation:'pulse 1.8s infinite'}}/>
            Live · {timeStr} IST
          </div>
        </div>

        {/* Loading */}
        {!data.loaded&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:2,marginBottom:24}}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'16px 18px'}}>
                <Skel w="60px" h={8} mb={12}/><Skel w="80%" h={22} mb={8}/><Skel w="50%" h={10}/>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {data.loaded&&data.error&&(
          <div style={{textAlign:'center',padding:'40px',color:'#444',fontSize:12,fontFamily:'monospace'}}>could not load market data · check your connection</div>
        )}

        {/* Indices grid */}
        {data.loaded&&!data.error&&(
          <>
            <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:12}}>Market indices</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:2,marginBottom:28}}>
              {data.indices.filter(p=>p.price!=='N/A').map((p,i)=><IndexCard key={i} p={p}/>)}
            </div>

            {/* Movers */}
            {data.movers&&data.movers.filter(p=>p.price!=='N/A').length>0&&(
              <div style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'18px',marginBottom:28}}>
                <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:14}}>Stocks to watch</div>
                {data.movers.filter(p=>p.price!=='N/A').map((p,i)=><MoverRow key={i} p={p}/>)}
              </div>
            )}

            {/* What to know today */}
            <div style={{background:'#0d0d18',border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'18px',marginBottom:28}}>
              <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:16}}>What to know today</div>
              {data.news.slice(0,5).map((n,i)=>{
                const sent = calcSentiment(n.headline,n.summary,n.source,'general');
                return (
                  <div key={i} style={{paddingBottom:14,marginBottom:14,borderBottom:i<4?'1px solid rgba(255,255,255,.04)':'none'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:6}}>
                      <span style={{width:4,height:4,borderRadius:'50%',background:sent.color,flexShrink:0,marginTop:6}}/>
                      <p style={{fontSize:'clamp(12px,2.5vw,14px)',color:'#ccc',lineHeight:1.5,margin:0,fontFamily:'Georgia,serif',fontWeight:500}}>{n.headline}</p>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,paddingLeft:14}}>
                      <span style={{fontSize:9,color:'#333',fontFamily:'monospace'}}>{n.source}</span>
                      <span style={{fontSize:9,color:'#222',fontFamily:'monospace'}}>·</span>
                      <span style={{fontSize:9,color:'#333',fontFamily:'monospace'}}>{n.time}</span>
                      <span style={{fontSize:9,color:sent.color,fontFamily:'monospace',marginLeft:'auto'}}>{sent.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Market mood summary */}
            {data.indices.length>0&&(
              <div style={{border:'1px solid rgba(255,255,255,.09)',borderRadius:10,padding:'18px',marginBottom:28,background:'rgba(255,255,255,.01)'}}>
                <div style={{fontSize:9,color:'#333',fontFamily:'monospace',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:12}}>Today at a glance</div>
                {(()=>{
                  const nifty = data.indices.find(p=>p.symbol==='^NSEI');
                  const sp = data.indices.find(p=>p.symbol==='^GSPC');
                  const up = (nifty?.up||false) && (sp?.up||false);
                  const mixed = (nifty?.up||false) !== (sp?.up||false);
                  const mood = mixed?'Mixed':'Both Indian and US markets are '+(up?'up':'down')+' today.';
                  const tip = mixed
                    ? 'When India and US markets move in opposite directions, focus on domestic triggers — FII flows, RBI, and earnings matter more than global cues.'
                    : up
                    ? 'Broad market strength is a positive signal. Watch if volume confirms the move — price gains on low volume are less reliable.'
                    : 'Broad market weakness tends to hit mid and small caps harder. Quality large caps with strong balance sheets usually recover faster.';
                  return (
                    <>
                      <p style={{fontSize:'clamp(13px,2.5vw,15px)',color:'#777',lineHeight:1.8,fontFamily:'Georgia,serif',marginBottom:12}}>{mood}</p>
                      <p style={{fontSize:'clamp(12px,2vw,13px)',color:'#444',lineHeight:1.8,fontFamily:'Georgia,serif',borderLeft:'2px solid rgba(255,255,255,.08)',paddingLeft:12}}>{tip}</p>
                    </>
                  );
                })()}
              </div>
            )}

            <div style={{fontSize:9,color:'#1e1e1e',fontFamily:'monospace',textAlign:'center',paddingTop:8}}>
              stoxify · live market data · sentiment is indicative only · not financial advice
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────
export default function App(){
  const [page,setPage]=useState('home');
  const [feedTicker,setFeedTicker]=useState('MARKET');
  const [dark,setDark]=useState(true);
  const [time,setTime]=useState(new Date());
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  const timeStr=time.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const goToFeed=sym=>{setFeedTicker(sym||'MARKET');setPage('feed');};

  return(
    <div style={{background:dark?'#07070f':'#f8f8f5',minHeight:'100vh'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:#1e1e1e;}
        *{-ms-overflow-style:none;scrollbar-width:none;}
        ::-webkit-scrollbar{display:none;}
        button:focus{outline:none;}
      `}</style>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 16px',height:44,borderBottom:'1px solid rgba(255,255,255,.09)',background:'#07070f',position:'sticky',top:0,zIndex:100}}>
        <button onClick={()=>setPage('home')} style={{display:'flex',alignItems:'center',gap:7,background:'transparent',border:'none',cursor:'pointer',padding:0,WebkitTapHighlightColor:'transparent'}}>
          <span style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'pulse 1.8s infinite'}}/>
          <span style={{fontSize:16,fontWeight:700,color:'#e8e8e8',fontFamily:'Georgia,serif'}}>Stoxify</span>
        </button>
        <div style={{display:'flex',alignItems:'center',gap:1}}>
          {[['home','Home'],['feed','Feed'],['briefing','Briefing'],['watchlist','Watch'],['compare','Compare']].map(([p,l])=>(
            <button key={p} onClick={()=>setPage(p)}
              style={{fontSize:10,color:page===p?'#888':'#1e1e1e',background:page===p?'rgba(255,255,255,.08)':'transparent',border:'none',cursor:'pointer',fontFamily:'monospace',padding:'6px 9px',borderRadius:4,letterSpacing:'0.05em',textTransform:'uppercase',transition:'all .12s',whiteSpace:'nowrap',WebkitTapHighlightColor:'transparent'}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setDark(d=>!d)}
            style={{fontSize:10,color:dark?'#555':'#777',background:dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.06)',border:`1px solid ${dark?'rgba(255,255,255,.1)':'rgba(0,0,0,.12)'}`,borderRadius:5,padding:'4px 12px',cursor:'pointer',fontFamily:'monospace',transition:'all .15s',WebkitTapHighlightColor:'transparent'}}>
            {dark?'light':'dark'}
          </button>
          <span style={{fontSize:9,color:dark?'#333':'#aaa',fontFamily:'monospace',flexShrink:0}}>{timeStr}</span>
        </div>
      </div>
      {page==='home'&&<Homepage onLaunch={()=>setPage('feed')} dark={dark}/>}
      {page==='feed'&&<NewsFeed initialSym={feedTicker} dark={dark}/>}
      {page==='briefing'&&<Briefing dark={dark}/>}
      {page==='watchlist'&&<Watchlist onSearch={goToFeed} dark={dark}/>}
      {page==='compare'&&<Compare dark={dark}/>}
    </div>
  );
}
