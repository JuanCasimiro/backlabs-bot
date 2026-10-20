# TODO: open source hygiene

Checklist for making the repo ready for contributions.

## 1. In the repo

- [x] **CI with GitHub Actions** (2026-10-19, `.github/workflows/ci.yml`, job `check`): `npm ci` + `npm run check` on every push and PR to `main`, Node 24. Since 2026-10-20 with a Postgres service, so runtime tests run.
- [x] **Short `CONTRIBUTING.md`** (2026-10-19): setup, fork → branch → PR, TDD for the runtime, evals before prompts, an ADR per important decision.
- [x] **`.gitattributes`** with `eol=lf` so Biome passes on Windows clones (2026-10-20).

## 2. On GitHub (settings, after CI has run at least once)

**Settings → Rules → Rulesets → New ruleset → New branch ruleset**

- [ ] Name `main`, *Enforcement status* **Active**
- [ ] *Target branches*: **Include default branch**
- [ ] **Restrict deletions**
- [ ] **Block force pushes**
- [ ] **Require a pull request before merging**, *Required approvals* 1
- [ ] **Require status checks to pass**: the CI `check` job
- [ ] *Bypass list*: **Repository admin**, to keep pushing to `main` while this is a one-person project. Remove it when there are contributors.
- [ ] **Settings → Security → Private vulnerability reporting**: enable.

Only the owner can push by default; everyone else forks and opens a PR.

## 3. Later

**When the bot does something useful**
- [ ] README with a demo (GIF) and an example that runs end to end
- [ ] Issues labelled `good first issue`

**When there are contributors**
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] `SECURITY.md`
- [ ] Issue and PR templates in `.github/`
- [ ] `CODEOWNERS`
- [ ] Remove the ruleset bypass and work through PRs too

**If published to npm**
- [ ] Semver and a changelog (e.g. Changesets)

## Reminder

Never commit tokens or `.env` (they are in `.gitignore`). If one leaks, **revoke it**: deleting it in another commit is not enough, it stays in the history.
