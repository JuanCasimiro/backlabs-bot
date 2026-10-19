# TODO: reglas del repo open source

Checklist para dejar el repo listo para contribuciones. Se puede hacer desde cualquier compu.

## 1. En el repo (código)

- [ ] **CI con GitHub Actions**: `.github/workflows/ci.yml` que en cada push y PR a `main` instale con `npm ci` y corra `npm run check` (typecheck, lint, tests) con Node 24.
- [ ] **`CONTRIBUTING.md` corto**: cómo levantar el proyecto (`npm install`, `npm run check`), flujo fork → rama → PR, TDD para el runtime, evals antes de tocar prompts y un ADR por decisión importante.

## 2. En GitHub (settings, después de que el CI corrió al menos una vez)

En el repo: **Settings → Rules → Rulesets → New ruleset → New branch ruleset**

- [ ] Nombre: `main`, *Enforcement status*: **Active**
- [ ] *Target branches*: **Add target → Include default branch**
- [ ] **Restrict deletions**
- [ ] **Block force pushes**
- [ ] **Require a pull request before merging**, con *Required approvals*: 1
- [ ] **Require status checks to pass**: agregar el check del CI (aparece recién después de la primera corrida)
- [ ] *Bypass list*: **Add bypass → Repository admin**, para seguir pusheando directo a `main` mientras sea un proyecto de una persona. Sacarlo cuando haya contribuidores.

Por defecto solo el dueño puede pushear. Los demás hacen fork y PR, no hace falta configurarlo.

## 3. Más adelante

**Cuando el bot haga algo útil**
- [ ] README con demo (GIF del bot en Chatwoot) y `docker compose up` que funcione de punta a punta
- [ ] Issues con la etiqueta `good first issue`

**Cuando haya contribuidores**
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] `SECURITY.md`: reportes de vulnerabilidades en privado (*Settings → Security → Private vulnerability reporting*)
- [ ] Templates de issue y PR en `.github/`
- [ ] `CODEOWNERS` para que el dueño sea revisor obligatorio
- [ ] Sacar el bypass del ruleset y trabajar con PRs propios también

**Si se publica en npm**
- [ ] Versionado semver y changelog (por ejemplo con Changesets)

## Recordatorio

Nunca commitear tokens ni `.env` (ya están en `.gitignore`). Si se filtra uno, **revocarlo**: borrarlo en otro commit no alcanza, porque queda en el historial.
