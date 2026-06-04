"""Transaction "kind" classification — makes spend exclusions explicit.

After the client normalizes every source into one internal sign convention
(positive = money OUT / charge, negative = money IN / credit), kind is derived
from the description plus that direction. Most rows on a checking account are
NOT expenses; only true purchases count toward spend.

Kinds:
  purchase      money out for goods/services — counts as spend
  card_payment  paying a credit-card bill — EXCLUDED (the card charges are the spend)
  transfer      moving money between own accounts — EXCLUDED
  income        payroll, interest, inbound payments — EXCLUDED
  refund        money back to an account (not income) — EXCLUDED
  p2p           Zelle/Cash App/Venmo SENT to a person — ambiguous; EXCLUDED until
                the user manually tags it (then it counts)
"""

import re

KINDS = {"purchase", "income", "transfer", "card_payment", "refund", "p2p"}


def _has(d: str, terms) -> bool:
    """True if any term appears at the start of a word in d (left word
    boundary), so e.g. 'chase' matches 'chase credit' but not 'purchase'."""
    return any(re.search(rf"(?<!\w){re.escape(t)}", d) for t in terms)

# Credit-card issuers; a card payment is an issuer name + a payment indicator.
_ISSUERS = (
    "american express", "amex", "chase", "citi", "discover", "capital one",
    "capitalone", "barclay", "synchrony", "comenity", "us bank", "usaa",
    "wells fargo card",
)
_PAY_INDICATORS = ("ach pmt", "ccd pmt", "epay", "e-payment", "epayment", "online pmt",
                   "des:ach", "autopay", "auto pay", "bill pay", "billpay",
                   "web pmt", "web pymt", "pmt", "payment")
# Phrases that signal a credit-card payment on their own.
_CARD_PAYMENT_PHRASES = ("credit card payment", "credit crd", "card payment",
                         "cc payment", "cardmember serv")
# Inbound credit on a card statement that means the card was paid.
_CARD_PAID_INBOUND = ("thank you", "autopay", "auto pay", "online payment",
                      "mobile payment", "bill payment", "epayment", "e-payment")
_P2P = ("zelle", "cash app", "cashapp", "venmo")
_INCOME = ("payroll", "interest earned", "dir dep", "direct dep", "payment from",
           "irs treas", "ssa treas", "tax ref")
_INBOUND_HINTS = ("from", "received", "deposit")


def _is_card_payment(d: str) -> bool:
    if _has(d, _CARD_PAYMENT_PHRASES):
        return True
    return _has(d, _ISSUERS) and _has(d, _PAY_INDICATORS)


def _is_transfer(d: str) -> bool:
    if "online banking transfer" in d:
        return True
    return _has(d, ("transfer",)) and _has(d, ("chk", "sav", "checking", "savings"))


def classify_kind(description: str, amount_cents: int) -> str:
    """Classify a transaction into a kind from its description and internal
    sign (negative = money in)."""
    d = (description or "").lower()
    inbound = amount_cents < 0

    if _is_card_payment(d):
        return "card_payment"
    if _is_transfer(d):
        return "transfer"
    if _has(d, _P2P):
        # inbound P2P (money received) is income; sent is ambiguous P2P
        if inbound or _has(d, _INBOUND_HINTS):
            return "income"
        return "p2p"
    if _has(d, _INCOME):
        return "income"
    # Inbound credit on a card statement labeled as a payment = the card being
    # paid (e.g. Amex "ONLINE PAYMENT - THANK YOU"). Not income, not a refund.
    if inbound and _has(d, _CARD_PAID_INBOUND):
        return "card_payment"
    # Fall back to direction: money in that isn't income/transfer is a refund;
    # money out is a purchase.
    return "refund" if inbound else "purchase"


# A bank debit that exactly matches a credit-card payment is the bank paying the
# card — exclude it from spend even if its description didn't say so. Guarded by
# a minimum amount, since card payments are substantial and small exact matches
# with real purchases would otherwise be misflagged.
RECONCILE_MIN_CENTS = 10_000  # $100


def reconcile_card_payments(db, min_cents: int = RECONCILE_MIN_CENTS) -> int:
    """Flip 'purchase' rows whose amount equals a known credit-card payment to
    'card_payment'. Returns how many were reclassified."""
    from sqlalchemy import func, select  # local import avoids import cycle

    from .models import Transaction

    pay_amounts = {
        a for a in db.scalars(
            select(func.abs(Transaction.amount_cents)).where(
                Transaction.kind == "card_payment"
            )
        ).all()
        if a and a >= min_cents
    }
    if not pay_amounts:
        return 0
    flipped = 0
    for t in db.scalars(select(Transaction).where(Transaction.kind == "purchase")).all():
        if abs(t.amount_cents) in pay_amounts:
            t.kind = "card_payment"
            flipped += 1
    if flipped:
        db.commit()
    return flipped
