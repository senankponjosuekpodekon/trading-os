import pytest

from ml.regime_classifier import RegimeClassifier, STATE_LABELS


def synthetic_prices():
    prices = []
    price = 100.0
    for _ in range(100):
        price *= 1 + 0.001  # low volatility
        prices.append(price)
    for _ in range(100):
        price *= 1 + 0.01  # high volatility
        prices.append(price)
    return prices


def test_classifier_train_predict():
    classifier = RegimeClassifier()
    prices = synthetic_prices()
    model = classifier.train(prices)
    assert len(model.means) == classifier.num_states
    regimes = classifier.predict(prices[-50:])
    assert len(regimes) == 49
    assert all(r in STATE_LABELS for r in regimes)


def test_classifier_requires_data():
    classifier = RegimeClassifier()
    with pytest.raises(ValueError):
        classifier.train([100, 101])
