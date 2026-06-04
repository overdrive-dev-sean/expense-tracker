# Security Policy

This is a single-user, offline application: it has no authentication, no network
services beyond a localhost API, and stores everything in a local SQLite file you
control. There are no servers to attack and no credentials or data leave your
machine.

## Reporting a vulnerability

If you find a security issue (for example, a way the app could leak local data, a
dependency with a known CVE, or unsafe handling of an imported file), please
report it privately rather than opening a public issue:

- Use GitHub's **[Report a vulnerability](../../security/advisories/new)** (Security → Advisories), or
- Open a minimal issue asking for a private contact channel.

Please include steps to reproduce and the affected version/commit. We'll
acknowledge as soon as we can.

## Scope notes
- Imported CSVs are parsed client-side; never paste untrusted CSVs you don't
  understand. Reports about malicious-CSV handling are in scope.
- Keep your local database file (`expense_tracker.db`) protected like any other
  personal financial record — it is not encrypted at rest.
