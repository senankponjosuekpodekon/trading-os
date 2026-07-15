"""Tests unitaires — News scraper et sentiment."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


from routers.news_scraper import _sentiment_heuristic, _hash, aggregate_sentiment, ScrapedArticle, FearGreedResult


class TestSentimentHeuristic:
    def test_bullish_text(self):
        label, score = _sentiment_heuristic("Bitcoin breaks record high in massive rally")
        assert label == "bullish"
        assert score > 0

    def test_bearish_text(self):
        label, score = _sentiment_heuristic("Crypto crash after major exchange hack and sell-off")
        assert label == "bearish"
        assert score < 0

    def test_neutral_text(self):
        label, score = _sentiment_heuristic("The market opened today with usual activity")
        assert label == "neutral"
        assert score == 0.0

    def test_mixed_tends_neutral(self):
        label, score = _sentiment_heuristic("Bull rally but warning of a possible drop ahead")
        # one bull, one bear -> score 0 -> neutral
        assert label == "neutral"


class TestHash:
    def test_hash_stable(self):
        assert _hash("same text") == _hash("same text")
        assert _hash("text a") != _hash("text b")
        assert len(_hash("any")) == 12


class TestAggregateSentiment:
    def test_empty_list(self):
        result = aggregate_sentiment([])
        assert result["label"] == "neutral"
        assert result["score"] == 0.0
        assert result["bonus"] == 0

    def test_bullish_dominant(self):
        articles = [
            ScrapedArticle(title="Bull 1", url="#", source="x", source_type="rss", sentiment="bullish", score=0.5),
            ScrapedArticle(title="Bull 2", url="#", source="x", source_type="rss", sentiment="bullish", score=0.4),
            ScrapedArticle(title="Neutral", url="#", source="x", source_type="rss", sentiment="neutral", score=0.0),
        ]
        result = aggregate_sentiment(articles)
        assert result["label"] == "bullish"
        assert result["score"] > 0
        assert result["bonus"] > 0
        assert result["bullish"] == 2

    def test_bearish_dominant(self):
        articles = [
            ScrapedArticle(title="Bear 1", url="#", source="x", source_type="rss", sentiment="bearish", score=-0.5),
            ScrapedArticle(title="Bear 2", url="#", source="x", source_type="rss", sentiment="bearish", score=-0.4),
            ScrapedArticle(title="Neutral", url="#", source="x", source_type="rss", sentiment="neutral", score=0.0),
        ]
        result = aggregate_sentiment(articles)
        assert result["label"] == "bearish"
        assert result["score"] < 0
        assert result["bonus"] < 0
        assert result["bearish"] == 2

    def test_neutral_no_bonus(self):
        articles = [
            ScrapedArticle(title="Neutral 1", url="#", source="x", source_type="rss", sentiment="neutral", score=0.0),
            ScrapedArticle(title="Neutral 2", url="#", source="x", source_type="rss", sentiment="neutral", score=0.0),
        ]
        result = aggregate_sentiment(articles)
        assert result["label"] == "neutral"
        assert result["bonus"] == 0


class TestFearGreedResult:
    def test_default_neutral(self):
        result = FearGreedResult(value=50, label="Neutral", signal="neutral", bonus=0)
        assert result.value == 50
        assert result.bonus == 0

    def test_extreme_fear_contrarian_buy(self):
        result = FearGreedResult(value=15, label="Extreme Fear", signal="contrarian_buy", bonus=15)
        assert result.signal == "contrarian_buy"
        assert result.bonus == 15
