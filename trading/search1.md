LunarCrush
Platform
▾
Pricing
Enterprise
Use Cases
Blog

⌘K


EN
Sign In
Sign Up
Claude
+ Claude
AI-powered social intelligence with natural language queries.
API
Programmatic access to real-time social and market data.
MCP Server
Model Context Protocol server for AI agent integrations.
CLI
Command-line interface for quick social data lookups.
Discover
Browse trending topics, news, and social posts in real time.
Collections
Create custom topic groups and track what matters to you.
API
The Social Intelligence
layer for your stack
Real-time social sentiment, creator metrics, and market signals for 4,000+ cryptocurrencies, 2,000+ stocks, and millions of topics — delivered through a single REST API.
GET API KEY
cURL
JavaScript
Python

# Get topic intelligence for Bitcoin
import requests

res = requests.get(
    "https://lunarcrush.com/api4/public/topic/bitcoin/v1",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
data = res.json()
# Response
{"topic":"bitcoin","title":"Bitcoin","topic_rank":1,"num_contributors":65482,"social_dominance":32.14,"num_posts":142857,"interactions_per_post":892,"galaxy_score":72,"sentiment":68,"categories":"cryptocurrency"}
What You Get
Three layers of intelligence
Every API response combines social, creator, and market data into a single unified view.
🔍
Topic Intelligence
Real-time social metrics for any cryptocurrency, stock, or cultural topic — from Bitcoin to Taylor Swift.
sentiment
interactions
posts_active
social_dominance
contributors
galaxy_score
👤
Creator Intelligence
Profile-level data for millions of creators across X, YouTube, TikTok, and Reddit — who's influencing what.
followers
engagements
post_frequency
engagement_rate
influence_score
network
📈
Market Signals
Proprietary scores that fuse social activity with price data — Galaxy Score, AltRank, and more.
galaxy_score
alt_rank
market_cap
price
volume_24h
percent_change_24h
Coverage
Scale that matters
4,000+
Cryptocurrencies
with social + market data
2,000+
Stocks & ETFs
with social tracking
100M+
Posts / day
processed in real time
10M+
Creators
profiled across platforms
6
Platforms
X, Reddit, YouTube, TikTok, Instagram, News
50+
Categories
gaming, fashion, sports, politics...
Endpoints
One API, everything you need
RESTful endpoints with consistent JSON responses. No GraphQL complexity, no WebSocket setup.
GET
/public/topic/:topic/v1
Topic summary — sentiment, posts, contributors, Galaxy Score
topic
GET
/public/topic/:topic/time-series/v1
Historical time-series for any topic
topic
interval
start
GET
/public/topics/list/v1
Paginated list of all available topics with social metrics
sort
limit
GET
/public/creator/:network/:id/v1
Creator profile — followers, engagement rate, post frequency
network
id
GET
/public/creators/list/v1
Top creators ranked by influence, engagement, or audience
topic
sort
GET
/public/coins/list/v2
Cryptocurrency rankings with Galaxy Score and AltRank
sort
limit
GET
/public/coins/:coin/time-series/v2
Coin social + market time-series data
coin
interval
GET
/public/coins/:coin/meta/v2
Coin metadata — market cap, volume, price, categories
coin
VIEW FULL DOCS
→
Integrate
Multiple ways to connect
⚡
REST API
Simple HTTPS endpoints that return JSON. Works with any language, any framework. Fetch data in a single call.
fetch("https://lunarcrush.com/api4/public/topic/bitcoin/v1",
  { headers: { Authorization: "Bearer KEY" } })

🤖
MCP Server
Connect LunarCrush directly to Claude, Cursor, or any MCP-compatible AI. The model reads live social data natively.
$ claude mcp add lunarcrush
  https://lunarcrush.ai/mcp
  --header "Authorization: Bearer KEY"

🔧
Agent Frameworks
Plug into LangChain, CrewAI, or custom agents. Give your AI tools real-time social awareness without building scrapers.
from langchain.tools import Tool
tool = Tool(name="lunarcrush",
  func=fetch_topic, description="...")

Use Cases
Built for builders
📊
Trading Signals
Combine sentiment shifts with price action to surface trade setups before the crowd moves.
📈
Portfolio Monitoring
Overlay social signals on your holdings to catch narrative shifts and sentiment divergences early.
🏢
Brand Tracking
Monitor how any brand, product, or public figure trends across social platforms in real time.
🤖
AI Agent Layer
Give your LLM agent live social context — sentiment, trending topics, creator activity — as a native tool.
🔬
Research
Backtest social signals, analyze creator networks, or study the relationship between sentiment and price.
✍️
Content Strategy
Identify trending topics and optimal posting times to maximize reach and engagement for your content.
Authentication
Simple Bearer token auth
One key, every endpoint
Generate an API key from your LunarCrush dashboard and pass it as a Bearer token in the Authorization header. No OAuth flows, no API secret rotation — just a single key that works everywhere.
✓
Free tier — 500 requests/day, no credit card
✓
Pro tier — unlimited requests, priority support
✓
Rate limits returned in response headers
auth.js

const res = await fetch(
  "https://lunarcrush.com/api4/public/topic/bitcoin/v1",
  {
    headers: {
      Authorization: "Bearer YOUR_API_KEY"
    }
  }
);
Start Building
Your app deserves real-time social intelligence
Get your API key and start building with live social data in minutes.
GET FREE API KEY
→
Free tier available. No credit card required to start.
LunarCrush
The Social Intelligence Layer
Platform
LunarCrush + Claude
LunarCrush API
LunarCrush MCP
LunarCrush CLI
LunarCrush Discover
LunarCrush Collections
Company
About
Affiliates
Careers
FAQs
Shop
Brand Resources
© 2026 LunarCrush. All rights reserved.
Terms
Privacy Policy
X
Telegram
YouTube
Instagram






