"""Unit tests for the kind classifier (pure: description + internal sign)."""
import pytest

from app.kinds import classify_kind

# internal sign: positive = money out, negative = money in
CASES = [
    ("BLUE BOTTLE COFFEE", 625, "purchase"),
    ("TMOBILE*AUTO PAY 05/15 PURCHASE", 7500, "purchase"),     # not a card payment
    ("AMERICAN EXPRESS DES:ACH PMT INDN:SEAN", 222475, "card_payment"),
    ("ONLINE PAYMENT - THANK YOU", -222475, "card_payment"),   # card-side credit
    ("Online Banking transfer to CHK 9516", 250000, "transfer"),
    ("Overdrive Energy DES:PAYROLL ID:123", -372379, "income"),
    ("Interest Earned", -22, "income"),
    ("Zelle payment to Gale Therapist for stuff", 27500, "p2p"),
    ("Zelle payment from MYRIAM GIRALDO", -100000, "income"),  # inbound P2P = income
    ("SOME RANDOM REFUND CREDIT", -1500, "refund"),            # money in, unclassified
]


@pytest.mark.parametrize("desc,cents,expected", CASES)
def test_classify_kind(desc, cents, expected):
    assert classify_kind(desc, cents) == expected
