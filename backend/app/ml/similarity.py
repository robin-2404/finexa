"""Nearest historical (training) transactions in the model's standardized feature space.

The space is V1-V28 plus log-scaled/standardized Amount from the SAVED preprocessing;
Time is excluded (dataset-relative) and the target label is never part of the vectors.
"""
from __future__ import annotations

import numpy as np
from sklearn.neighbors import NearestNeighbors

from ..constants import FEATURE_COLUMNS, SIMILARITY_EXCLUDED

SIM_COLUMNS = [c for c in FEATURE_COLUMNS if c not in SIMILARITY_EXCLUDED]
SIM_IDX = [FEATURE_COLUMNS.index(c) for c in SIM_COLUMNS]


def to_similarity_space(transformed: np.ndarray) -> np.ndarray:
    return np.asarray(transformed, dtype=np.float32)[:, SIM_IDX]


class SimilarityIndex:
    def __init__(self, train_positions: np.ndarray, train_space: np.ndarray, centroids: np.ndarray | None):
        self.positions = np.asarray(train_positions)
        self.nn = NearestNeighbors(algorithm="brute", metric="euclidean").fit(train_space)
        self.centroids = None if centroids is None else np.asarray(centroids, dtype=np.float32)

    def query(self, vec: np.ndarray, k: int, exclude_position: int | None = None):
        """Return (positions, distances) of the k nearest training rows, excluding `exclude_position`."""
        extra = 1 if exclude_position is not None else 0
        dist, idx = self.nn.kneighbors(vec.reshape(1, -1), n_neighbors=k + extra)
        pos = self.positions[idx[0]]
        d = dist[0]
        if exclude_position is not None:
            keep = pos != exclude_position
            pos, d = pos[keep][:k], d[keep][:k]
        return pos, d

    def cluster_of(self, vec: np.ndarray) -> int | None:
        if self.centroids is None:
            return None
        return int(np.argmin(((self.centroids - vec.reshape(1, -1)) ** 2).sum(axis=1)))
