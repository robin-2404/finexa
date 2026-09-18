import numpy as np
import pytest

from app.services.policy import Policy, PolicyError, rehearse, validate_thresholds


def test_boundaries_are_inclusive_at_the_threshold():
    p = Policy(0.3, 0.8)
    assert p.decide_one(0.2999999) == ("low", "allow")
    assert p.decide_one(0.3) == ("medium", "review")
    assert p.decide_one(0.7999999) == ("medium", "review")
    assert p.decide_one(0.8) == ("high", "hold")
    assert p.decide_one(1.0) == ("high", "hold")
    assert p.decide_one(0.0) == ("low", "allow")
    a = p.actions(np.array([0.0, 0.3, 0.8]))
    assert list(a) == ["allow", "review", "hold"]
    assert list(p.bands(np.array([0.0, 0.3, 0.8]))) == ["low", "medium", "high"]


@pytest.mark.parametrize("r,h", [(0.5, 0.5), (0.6, 0.5), (-0.1, 0.5), (0.1, 1.01), (float("nan"), 0.5), (0.1, float("inf"))])
def test_invalid_thresholds_rejected(r, h):
    with pytest.raises(PolicyError):
        validate_thresholds(r, h)


def test_extreme_valid_thresholds_accepted():
    Policy(0.0, 1.0)
    Policy(0.0, 1e-9)


def test_policy_version_reflects_thresholds():
    assert Policy(0.1, 0.9).version != Policy(0.1, 0.8).version


SCORES = np.array([0.9, 0.8, 0.7, 0.6, 0.5, 0.1])
LABELS = np.array([1, 0, 1, 1, 0, 1])
AMOUNTS = np.array([100.0, 10.0, 20.0, 30.0, 40.0, 500.0])
POL = Policy(0.5, 0.85)


def test_capacity_and_overflow_never_counted_as_reviewed():
    m = rehearse(SCORES, LABELS, AMOUNTS, POL, review_capacity=2, batch_size=None)
    assert m["alerts"]["hold_recommended"] == 1
    assert m["alerts"]["review_demand"] == 4
    assert m["alerts"]["cases_within_capacity"] == 2
    assert m["alerts"]["overflow"] == 2
    assert m["alerts"]["cases_within_capacity"] + m["alerts"]["overflow"] == m["alerts"]["review_demand"]
    # highest-scoring candidates (0.8, 0.7) are reviewed; 0.6 and 0.5 overflow
    assert m["known_fraud"]["review_within_capacity"] == 1  # 0.7 fraud
    assert m["known_fraud"]["review_overflow"] == 1  # 0.6 fraud
    assert m["known_fraud"]["allowed"] == 1  # 0.1 fraud
    assert m["fraud_value"]["review_overflow"] == 30.0
    assert m["fraud_value"]["allowed"] == 500.0
    assert m["fraud_value"]["allowed_or_unreviewed"] == 530.0
    assert m["known_legitimate"]["review_overflow"] == 1  # 0.5 legit
    assert m["known_fraud"]["flagged_total"] == 3


def test_capacity_zero_and_unlimited():
    z = rehearse(SCORES, LABELS, AMOUNTS, POL, review_capacity=0, batch_size=None)
    assert z["alerts"]["cases_within_capacity"] == 0 and z["alerts"]["overflow"] == 4
    u = rehearse(SCORES, LABELS, AMOUNTS, POL, review_capacity=None, batch_size=None)
    assert u["alerts"]["overflow"] == 0 and u["alerts"]["cases_within_capacity"] == 4
    big = rehearse(SCORES, LABELS, AMOUNTS, POL, review_capacity=100, batch_size=None)
    assert big["alerts"]["overflow"] == 0


def test_capacity_is_applied_per_batch():
    # batch_size=3 -> [0.9,0.8,0.7] and [0.6,0.5,0.1]; capacity 1 each
    m = rehearse(SCORES, LABELS, AMOUNTS, POL, review_capacity=1, batch_size=3)
    assert m["alerts"]["batches"] == 2
    assert m["alerts"]["cases_within_capacity"] == 2  # 0.8 in batch 1, 0.6 in batch 2
    assert m["alerts"]["overflow"] == 2  # 0.7 and 0.5
    assert m["known_fraud"]["review_within_capacity"] == 1  # 0.6 fraud reviewed
    assert m["known_fraud"]["review_overflow"] == 1  # 0.7 fraud overflows


def test_ties_break_by_time_order():
    scores = np.array([0.6, 0.6, 0.6])
    m = rehearse(scores, np.array([1, 0, 0]), np.ones(3), Policy(0.5, 0.9), 1, None)
    assert m["known_fraud"]["review_within_capacity"] == 1  # earliest tied row is reviewed first


def test_empty_input():
    m = rehearse(np.array([]), np.array([]), np.array([]), POL, 5, None)
    assert m["population"]["rows"] == 0 and m["flag_precision"] is None
