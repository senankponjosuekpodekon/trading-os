"""Hidden Markov based regime classifier (LOW / NORMAL / HIGH volatility)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple, Optional

import numpy as np

STATE_LABELS = ["LOW", "NORMAL", "HIGH"]


@dataclass
class RegimeModel:
    means: List[float]
    variances: List[float]
    transition: List[List[float]]
    priors: List[float]


class RegimeClassifier:
    def __init__(self, num_states: int = 3):
        self.num_states = num_states
        self.model: Optional[RegimeModel] = None

    def train(self, prices: Sequence[float], max_iter: int = 50, tol: float = 1e-4) -> RegimeModel:
        obs = self._observations(prices)
        if len(obs) < self.num_states:
            raise ValueError("Not enough data to train regime classifier")

        means, variances = self._init_emissions(obs)
        transition = np.full((self.num_states, self.num_states), 1 / self.num_states)
        priors = np.full(self.num_states, 1 / self.num_states)

        log_likelihood = None
        for _ in range(max_iter):
            alpha, scale = self._forward(obs, means, variances, transition, priors)
            beta = self._backward(obs, means, variances, transition, scale)
            gamma, xi = self._expectation(alpha, beta, transition, obs, means, variances)

            means_new, variances_new = self._update_emissions(obs, gamma)
            transition_new = self._update_transition(xi)
            priors_new = gamma[0]

            new_ll = -np.sum(np.log(scale))
            if log_likelihood is not None and abs(new_ll - log_likelihood) < tol:
                break
            means, variances, transition, priors = means_new, variances_new, transition_new, priors_new
            log_likelihood = new_ll

        self.model = RegimeModel(
            means=means.tolist(),
            variances=variances.tolist(),
            transition=transition.tolist(),
            priors=priors.tolist(),
        )
        return self.model

    def predict(self, prices: Sequence[float]) -> List[str]:
        if not self.model:
            raise ValueError("Model not trained")
        obs = self._observations(prices)
        path = self._viterbi(
            obs,
            np.array(self.model.means),
            np.array(self.model.variances),
            np.array(self.model.transition),
            np.array(self.model.priors),
        )
        ordering = np.argsort(self.model.means)
        mapped = {int(state): STATE_LABELS[idx] for idx, state in enumerate(ordering)}
        return [mapped[int(p)] for p in path]

    # ─── HMM helpers ─────────────────────────────────────────────

    def _observations(self, prices: Sequence[float]) -> np.ndarray:
        arr = np.asarray(prices, dtype=float)
        if arr.ndim != 1:
            raise ValueError("prices must be 1-D sequence")
        returns = np.diff(arr) / arr[:-1]
        if len(returns) == 0:
            raise ValueError("Not enough price points")
        atr_like = self._ema(np.abs(returns), span=14)
        z = np.clip(np.abs(returns) / (atr_like + 1e-6), 0, 50)
        return z

    def _init_emissions(self, obs: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        percentiles = np.linspace(0, 100, self.num_states + 2)[1:-1]
        means = np.percentile(obs, percentiles)
        variances = np.full(self.num_states, np.var(obs) if np.var(obs) > 1e-4 else 1.0)
        return means, variances

    def _forward(self, obs, means, variances, transition, priors):
        T = len(obs)
        alpha = np.zeros((T, self.num_states))
        scale = np.zeros(T)
        emission = self._gaussians(obs, means, variances)
        alpha[0] = priors * emission[0]
        scale[0] = alpha[0].sum() + 1e-12
        alpha[0] /= scale[0]
        for t in range(1, T):
            alpha[t] = emission[t] * (alpha[t - 1] @ transition)
            scale[t] = alpha[t].sum() + 1e-12
            alpha[t] /= scale[t]
        return alpha, scale

    def _backward(self, obs, means, variances, transition, scale):
        T = len(obs)
        beta = np.zeros((T, self.num_states))
        emission = self._gaussians(obs, means, variances)
        beta[-1] = 1 / scale[-1]
        for t in reversed(range(T - 1)):
            beta[t] = (transition @ (emission[t + 1] * beta[t + 1])) / scale[t]
        return beta

    def _expectation(self, alpha, beta, transition, obs, means, variances):
        T = len(obs)
        gamma = alpha * beta
        gamma /= gamma.sum(axis=1, keepdims=True)
        emission = self._gaussians(obs, means, variances)
        xi = np.zeros((T - 1, self.num_states, self.num_states))
        for t in range(T - 1):
            numerator = (
                alpha[t][:, None]
                * transition
                * emission[t + 1]
                * beta[t + 1]
            )
            denom = numerator.sum()
            if denom == 0:
                denom = 1e-12
            xi[t] = numerator / denom
        return gamma, xi

    def _update_emissions(self, obs: np.ndarray, gamma: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        weights = gamma.sum(axis=0)
        means = (gamma.T @ obs) / (weights + 1e-12)
        diff = obs[None, :] - means[:, None]
        variances = ((gamma.T * diff**2).sum(axis=1) / (weights + 1e-12)).clip(min=1e-4)
        return means, variances

    def _update_transition(self, xi: np.ndarray) -> np.ndarray:
        numerator = xi.sum(axis=0)
        denominator = numerator.sum(axis=1, keepdims=True)
        return numerator / (denominator + 1e-12)

    def _viterbi(self, obs, means, variances, transition, priors):
        T = len(obs)
        emission = self._gaussians(obs, means, variances)
        log_trans = np.log(transition + 1e-12)
        log_emission = np.log(emission + 1e-12)
        log_priors = np.log(priors + 1e-12)

        dp = np.zeros((T, self.num_states))
        path = np.zeros((T, self.num_states), dtype=int)
        dp[0] = log_priors + log_emission[0]
        for t in range(1, T):
            for j in range(self.num_states):
                scores = dp[t - 1] + log_trans[:, j]
                path[t, j] = np.argmax(scores)
                dp[t, j] = scores[path[t, j]] + log_emission[t, j]
        states = np.zeros(T, dtype=int)
        states[-1] = int(np.argmax(dp[-1]))
        for t in reversed(range(1, T)):
            states[t - 1] = path[t, states[t]]
        return states

    def _gaussians(self, obs, means, variances):
        diff = obs[:, None] - means[None, :]
        exp_term = np.exp(-0.5 * diff**2 / variances)
        coef = 1 / np.sqrt(2 * np.pi * variances)
        return coef * exp_term

    def _ema(self, values: np.ndarray, span: int = 14) -> np.ndarray:
        ema = np.zeros_like(values)
        alpha = 2 / (span + 1)
        ema[0] = values[0]
        for i in range(1, len(values)):
            ema[i] = alpha * values[i] + (1 - alpha) * ema[i - 1]
        return ema


regime_classifier = RegimeClassifier()
