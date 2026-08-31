# Security Policy

SLR Harvester is a research tool for conducting systematic literature reviews.
It runs entirely in the browser: there is no server operated by this project,
and no build step between the source in this repository and what a browser
executes.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting instead — the *Report a
vulnerability* button under the repository's **Security** tab. That channel is
private between you and the maintainer, and it lets a fix be prepared before
the problem becomes public.

If that route is unavailable to you, write to the address on the maintainer's
GitHub profile and put `SECURITY` in the subject line.

What helps most in a report:

- what you did, step by step, and what happened
- which browser and version, and which of the two storage modes was active
  (local folder or Cloud Sync)
- whether any data left the browser, and to where
- a proof of concept, if you have one

Please do not test against other people's accounts or data. A local project
folder of your own, or an account you created yourself, is all that is needed
to demonstrate almost anything in this application.

### What to expect

This project is maintained by one person alongside other work. An
acknowledgement should reach you within a week. A fix follows as quickly as the
severity warrants; for anything that exposes another user's data, that means
immediately.

You will be credited in the release notes unless you prefer otherwise.

## Supported versions

Only the version currently deployed at
<https://socresearcher.github.io/slr-harvester/> is supported. There are no
maintained release branches, and older commits receive no fixes.

The application is in an **open beta**. It is offered free of charge and
without any guarantee of availability. Anyone using it for a thesis or a
publication should keep their own copies of the project data — see *Data
handling* below.

## Scope

**In scope**

- the application itself: `slr-harvester_web/` — HTML, CSS and JavaScript
- the Cloud Sync backend schema in `slr-harvester_web/supabase/schema.sql`,
  in particular the row level security policies that separate accounts
- the deployment workflow in `.github/workflows/`
- the Python desktop application under `src/`

**Out of scope**

- the bibliographic databases this application queries (Scopus, PubMed,
  OpenAlex) and Crossref — report those to their operators
- GitHub Pages and Supabase as platforms — report those to GitHub and Supabase
- findings that require an attacker to already control the user's machine,
  browser profile or account
- the absence of a feature, as opposed to a defect in one that exists

## Data handling

Two storage modes exist, and which one is active determines where data lives:

- **Local folder** (the default). Project data is read from and written to a
  folder the user picks, through the File System Access API. Nothing is
  uploaded. Only the permission handle for that folder is remembered, in
  IndexedDB — never the contents.
- **Cloud Sync** (optional). The same data is stored in a PostgreSQL database
  at Supabase, separated per account by row level security, so the database
  itself refuses to hand a row to anyone but its owner.

Search queries reach the bibliographic databases directly from the browser.
API keys entered in Settings are stored in the browser and sent only to the
provider they belong to.

The in-app *Privacy* view describes this in detail and is the authoritative
description for users.

## A note on this file

This policy covers the published application. Internal planning documents,
including the project's own security roadmap, are deliberately not part of this
repository.
